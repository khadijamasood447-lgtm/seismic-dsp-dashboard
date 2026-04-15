import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Files to upload to Supabase (only existing files)
const filesToUpload = [
  { local: 'public/videos/HEROSECTION.mp4', bucket: 'videos', remote: 'HEROSECTION.mp4' },
  { local: 'public/videos/aboutus.jpeg', bucket: 'images', remote: 'aboutus.jpeg' },
  { local: 'public/videos/soilbackground.jpg', bucket: 'images', remote: 'soilbackground.jpg' },
]

async function uploadFiles() {
  for (const file of filesToUpload) {
    if (!fs.existsSync(file.local)) {
      console.log(`⚠️ File not found: ${file.local}`)
      continue
    }
    
    try {
      const fileBuffer = fs.readFileSync(file.local)
      console.log(`📤 Uploading ${file.local} (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB)...`)
      
      const { error } = await supabase.storage
        .from(file.bucket)
        .upload(file.remote, fileBuffer, {
          cacheControl: '3600',
          upsert: true
        })
      
      if (error) {
        console.error(`❌ Error uploading ${file.local}:`, error.message)
      } else {
        console.log(`✅ Uploaded: ${file.local} -> ${file.bucket}/${file.remote}`)
      }
    } catch (err) {
      console.error(`❌ Failed to upload ${file.local}:`, err.message)
    }
  }
}

uploadFiles()
