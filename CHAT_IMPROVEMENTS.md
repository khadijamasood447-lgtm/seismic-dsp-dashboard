# Chat System Improvements

## Overview
Enhanced the Vs Assistant chatbot with improved response formatting, message controls, and file attachment persistence.

## Changes Made

### 1. **Response Format: JSON → Text/Table** ✅
**Problem**: Chat responses were showing raw JSON structures that were hard to read.

**Solution**: Implemented dedicated text formatters that convert comparison and location data into readable table formats.

**Files Changed**:
- Created: `lib/response-formatter.ts`
  - `formatComparisonAsText()` - Displays sector comparisons in formatted table with key findings
  - `formatLocationDataAsText()` - Shows location analysis with site class classification
  - `formatSoilCompositionAsText()` - Displays soil composition as readable table

- Updated: `app/api/chat/route.ts`
  - Imported response formatters
  - Modified `defaultAnswerFromData()` to use text formatters instead of JSON/markdown

**Example Output**:
```
📊 COMPARISON AT 2.0m DEPTH
════════════════════════════════════════════════
METRIC              │ G-6          │ I-8          │ DIFFERENCE
────────────────────┼──────────────┼──────────────┼──────────────
Vs Mean (m/s)       │        275.3 │        325.8 │         50.5
Vs P10 (m/s)        │        245.1 │        295.2 │         50.1
Vs P90 (m/s)        │        305.5 │        356.4 │         50.9
Std Dev (m/s)       │         30.2 │         61.2 │         31.0
════════════════════════════════════════════════

KEY FINDINGS:
• I-8 has HIGHER Vs (+50.5 m/s) → stiffer/more stable soil
• Uncertainty range: G-6 [245-306 m/s], I-8 [295-356 m/s]
• These are research-grade predictions for screening purposes only
```

---

### 2. **Message Controls: Delete, Copy, Retry** ✅
**Problem**: Users couldn't manage their chat history or retry previous prompts.

**Solution**: Added message action buttons with intuitive controls.

**Files Changed**:
- Updated: `components/ChatbotWidget.tsx`
  - Added `attachedFile` property to ChatMsg type
  - Enhanced message rendering with action buttons:
    - **📋 Copy**: Copy message text to clipboard
    - **↩️ Retry**: Edit and resend previous user message (clears assistant responses after)
    - **🗑️ Delete**: Remove messages from chat

**Features**:
- Copy button available on all messages
- Retry button available on user messages (not first message)
- Delete button available on last message or any user message
- Color-coded: Red delete button for clarity

---

### 3. **File Attachment Persistence** ✅
**Problem**: Uploaded IFC files would disappear from chat after being sent, confusing users about what was analyzed.

**Solution**: Display file attachments in chat as persistent indicators.

**Files Changed**:
- Updated: `components/ChatbotWidget.tsx`
  - Added `attachedFile` field to ChatMsg type
  - File attachment displays above user message:
    ```
    📎 model.ifc (IFC Model)
    ```
  - File remains visible throughout conversation
  - Shows file name and type badge

**Implementation Details**:
- When IFC file is uploaded, it's stored in the message object
- File reference persists in session history
- Visual indicator clearly shows what file was being analyzed

---

### 4. **Improved Chat Message Structure** ✅
**Files Changed**:
- Updated: `components/ChatbotWidget.tsx`

**Enhanced Message Type**:
```typescript
type ChatMsg = {
  id: string
  role: "user" | "assistant"
  text: string
  suggestedActions?: string[]
  dataQuoted?: any
  citations?: Array<{ doc?: string; section?: string; clause?: string; table?: string; page?: number }>
  complianceResult?: any
  reportUrl?: string | null
  status?: string
  errorCode?: string | null
  attachedFile?: { name: string; type: string; url: string }  // ← NEW
}
```

---

## Usage Examples

### Scenario 1: Compare Two Sectors
**User**: "compare the clay content percentages between the G-6 vs I-8"

**Response** (before):
```json
{
  "response": "Based on the soil composition analysis...",
  "citations": [...]
}
```

**Response** (after):
```
📊 COMPARISON AT 2.0m DEPTH
════════════════════════════════════════════════
METRIC              │ G-6          │ I-8          │ DIFFERENCE
...
KEY FINDINGS:
• I-8 has significantly higher clay content (3.2x more)
• Higher clay in I-8 suggests greater cohesion
...
```

### Scenario 2: Upload IFC & Ask Question
1. User uploads `building_model.ifc` via file picker
2. User types: "Check if this complies with BCP-SP 2021"
3. Chat displays:
   ```
   📎 building_model.ifc (IFC Model)
   Check if this complies with BCP-SP 2021
   ```
4. File reference persists throughout the conversation
5. User can copy/delete/retry as needed

### Scenario 3: Retry Previous Prompt
1. User asks: "What does Vs=350 m/s mean?"
2. Assistant responds
3. User doesn't like the answer, clicks **↩️ Retry**
4. Message input is restored: "What does Vs=350 m/s mean?"
5. All assistant responses after this are cleared
6. User can edit and resend

---

## Technical Details

### Response Formatter Functions

#### `formatComparisonAsText(data)`
- Converts sector comparison data to table format
- Shows Vs, P10, P90, Standard deviation
- Includes interpretation of differences
- Formats as monospace ASCII table

#### `formatLocationDataAsText(data)`
- Displays query vs nearest grid point
- Shows Vs predictions with uncertainty
- Calculates and displays BCP-SP 2021 site class
- Clear structured layout

#### `formatSoilCompositionAsText(data)`
- Shows sand/silt/clay percentages
- Displays moisture and bulk density
- Provides geotechnical interpretation
- References liquefaction/consolidation risks

### Chat API Changes
- `/api/chat` endpoint now uses `formatComparisonAsText()` for comparison responses
- Maintains JSON structure for non-data responses (Claude AI responses)
- Backward compatible with existing chat UI

---

## Testing Recommendations

1. **Response Format**:
   - Test: "Compare G-6 vs I-8"
   - Verify: Table format displays correctly with proper alignment

2. **File Attachments**:
   - Upload an IFC file
   - Send a compliance question
   - Verify: File indicator persists above user message
   - Verify: File name and type are shown

3. **Message Controls**:
   - Send multiple messages
   - Test: Copy button copies correct text
   - Test: Retry button restores message and clears subsequent responses
   - Test: Delete removes messages

4. **Compatibility**:
   - Verify session history loads files correctly
   - Verify chat persists after page reload
   - Test multiple sequential conversations

---

## Future Enhancements

1. **Table Export**: Add ability to export comparison tables as CSV/Excel
2. **Message Editing**: Full edit capability (not just retry)
3. **File Preview**: Show IFC preview thumbnail before analysis
4. **Template Responses**: Pre-built prompts for common analysis types
5. **Batch Comparisons**: Compare 3+ sectors in single request
6. **Response History**: View all past API responses in JSON format

---

## Notes

- IFC visualization issues (if any) are handled separately in `components/Visualization3D.tsx`
- File uploads use Supabase Storage with signed URLs
- All responses include disclaimer about preliminary assessment status
- Suggested actions are contextually appropriate for each response type
