"use client"

type SessionItem = {
  id: string
  session_title?: string | null
  last_message_at?: string | null
}

type Props = {
  sessions: SessionItem[]
  activeSessionId: string | null
  onSelect: (id: string) => void
  onNewChat: () => void
  onRename: (id: string) => void
  onDelete: (id: string) => void
}

export default function SessionHistory({ sessions, activeSessionId, onSelect, onNewChat, onRename, onDelete }: Props) {
  return (
    <div className="w-[220px] border-r border-gray-300 bg-gray-50 flex flex-col">
      <div className="px-3 py-3 border-b border-gray-300 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-gray-900 tracking-wide">Sessions</div>
          <div className="text-[11px] text-gray-600">Persistent chat history</div>
        </div>
        <button
          onClick={onNewChat}
          className="rounded-md border border-gray-300 bg-gray-100 px-2 py-1 text-[11px] text-gray-900 hover:bg-gray-200"
        >
          New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {sessions.length === 0 ? (
          <div className="px-2 py-3 text-[12px] text-gray-600">No saved sessions yet.</div>
        ) : (
          sessions.map((s) => {
            const active = s.id === activeSessionId
            return (
              <div
                key={s.id}
                className={`rounded-lg border px-2 py-2 transition ${
                  active ? "border-[#0d9488]/60 bg-white" : "border-gray-300 bg-gray-100 hover:bg-gray-200"
                }`}
              >
                <button className="w-full text-left" onClick={() => onSelect(s.id)}>
                  <div className="text-[12px] font-medium text-gray-900 line-clamp-2">
                    {s.session_title?.trim() || "Untitled Session"}
                  </div>
                  <div className="mt-1 text-[10px] text-gray-600">
                    {s.last_message_at ? new Date(s.last_message_at).toLocaleString() : "No activity"}
                  </div>
                </button>
                <div className="mt-2 flex items-center gap-2">
                  <button onClick={() => onRename(s.id)} className="text-[10px] text-gray-600 hover:text-gray-900">
                    Rename
                  </button>
                  <button onClick={() => onDelete(s.id)} className="text-[10px] text-red-600 hover:text-red-700">
                    Delete
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

