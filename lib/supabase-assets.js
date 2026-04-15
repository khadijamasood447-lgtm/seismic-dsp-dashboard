import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function getAssetUrl(bucket, path) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return data.publicUrl
}

export function VideoPlayer({ fileName, className }) {
  const [url, setUrl] = React.useState('')
  
  React.useEffect(() => {
    getAssetUrl('videos', fileName).then(setUrl)
  }, [fileName])
  
  if (!url) return <div>Loading video...</div>
  return <video src={url} controls className={className} />
}

export function ImageAsset({ fileName, alt, className }) {
  const [url, setUrl] = React.useState('')
  
  React.useEffect(() => {
    getAssetUrl('images', fileName).then(setUrl)
  }, [fileName])
  
  if (!url) return <div>Loading image...</div>
  return <img src={url} alt={alt} className={className} />
}
