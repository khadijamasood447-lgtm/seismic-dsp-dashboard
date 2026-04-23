import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { getUserIdFromHeaders } from '@/lib/supabase/server'
import { insertChatMessage, upsertChatSession } from '@/lib/supabase/app-data'
import { extractIfcDataFromUrl } from '@/lib/compliance/bcp-checks'

export const dynamic = 'force-dynamic'

const pool = getDbPool()

export async function POST(req: Request) {
  try {
    const userId = getUserIdFromHeaders(req)
    const { message, conversation_id, attachments, context } = await req.json()

    if (!message && !attachments?.length) {
      return NextResponse.json({ ok: false, error: 'Message or attachment is required' }, { status: 400 })
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY
    const anthropicModel = process.env.ANTHROPIC_MODEL || 'claude-3-sonnet-20241022'

    if (!anthropicKey) {
      return NextResponse.json({ ok: false, error: 'Anthropic API key not configured' }, { status: 500 })
    }

    // 1. Extract IFC metadata if available
    let ifcMetadata = ''
    if (attachments && attachments.length > 0) {
      const ifcAttachment = attachments.find((a: any) => a.type === 'ifc')
      if (ifcAttachment?.file_url) {
        try {
          // Fast extraction with 10s timeout
          const data = await extractIfcDataFromUrl(ifcAttachment.file_url, ifcAttachment.file_name)
          ifcMetadata = `
          ATTACHED IFC DATA:
          File: ${data.file_name || 'unknown'}
          Building: ${data.building_name || 'unknown'}
          Storeys: ${data.stories_count || 'unknown'}
          Height: ${data.height_m ? data.height_m.toFixed(2) + 'm' : 'unknown'}
          Foundation: ${data.foundation_type || 'unknown'}
          Lateral System: ${data.lateral_system || 'unknown'}
          Element Counts: Columns=${data.element_counts?.columns || 0}, Beams=${data.element_counts?.beams || 0}, Footings=${data.element_counts?.footings || 0}, Walls=${data.element_counts?.walls || 0}
          Concrete Grade: ${data.concrete_grade_mpa || 'unknown'} MPa
          Steel Grade: ${data.steel_grade_mpa || 'unknown'} MPa
          Seismic Category (Declared): ${data.declared_seismic_category || 'unknown'}
          `
        } catch (err) {
          console.error('Metadata extraction failed:', err)
          ifcMetadata = '\n(Note: IFC metadata extraction failed or timed out, but the file is available for visualization.)\n'
        }
      }
    }

    // 2. Prepare conversation history and context
    const systemPrompt = `You are a Geo-Structural Engineering Assistant specializing in soil liquefaction risk assessment for Islamabad.
    
    GUIDELINES:
    1. Respond in natural, professional language.
    2. Use markdown tables ONLY when presenting comparative data or lists of structural elements.
    3. Do NOT wrap your entire response in JSON.
    4. Provide clear, actionable engineering insights.
    5. If a user uploads an IFC file, acknowledge it and offer to analyze it against BCP-SP 2021 codes using the provided metadata.
    
    CONTEXT:
    Current Location: ${context?.location || 'Unknown'}
    Lat/Lon: ${context?.lat || 'N/A'}, ${context?.lon || 'N/A'}
    Depth: ${context?.depth || '2.0'}m
    ${ifcMetadata}
    `

    // 2. Call Anthropic with streaming
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': anthropicKey,
        'anthropic-dangerous-direct-browser-access': 'true' // If needed, though this is server-side
      },
      body: JSON.stringify({
        model: anthropicModel,
        max_tokens: 1500,
        temperature: 0.2,
        system: systemPrompt,
        messages: [{ role: 'user', content: message }],
        stream: true,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Anthropic error: ${error}`)
    }

    // 3. Setup streaming response
    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body?.getReader()
        if (!reader) return

        let fullContent = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = new TextDecoder().decode(value)
          const lines = chunk.split('\n')

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))
                if (data.type === 'content_block_delta') {
                  const text = data.delta.text
                  fullContent += text
                  controller.enqueue(new TextEncoder().encode(text))
                }
              } catch (e) {
                // Ignore parse errors for non-json lines
              }
            }
          }
        }

        // 4. Save to database after stream completes
        if (conversation_id && userId) {
          try {
            await insertChatMessage({
              session_id: conversation_id,
              role: 'user',
              content: message,
              metadata: attachments ? { attachments } : {}
            })
            await insertChatMessage({
              session_id: conversation_id,
              role: 'assistant',
              content: fullContent
            })
          } catch (dbError) {
            console.error('Failed to save chat to DB:', dbError)
          }
        }

        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })

  } catch (error: any) {
    console.error('Chat stream error:', error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
}
