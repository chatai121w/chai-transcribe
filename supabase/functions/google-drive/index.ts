// Google Drive proxy via Lovable Connector Gateway
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const GATEWAY = 'https://connector-gateway.lovable.dev/google_drive';
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;
const GDRIVE_KEY = Deno.env.get('GOOGLE_DRIVE_API_KEY')!;

const extraCors = {
  ...corsHeaders,
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-info, x-supabase-client-platform, x-supabase-client-platform-version',
};

const authHeaders = () => ({
  Authorization: `Bearer ${LOVABLE_API_KEY}`,
  'X-Connection-Api-Key': GDRIVE_KEY,
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...extraCors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: extraCors });

  try {
    if (!LOVABLE_API_KEY || !GDRIVE_KEY) {
      return json({ error: 'Google Drive connector not configured' }, 500);
    }

    const { action, ...params } = await req.json();

    switch (action) {
      case 'list': {
        // List files, optionally inside a folder, optionally filter by mime
        const { folderId, query, pageSize = 100, pageToken, audioOnly } = params;
        const qParts: string[] = ['trashed = false'];
        if (folderId) qParts.push(`'${folderId}' in parents`);
        if (query) qParts.push(`name contains '${String(query).replace(/'/g, "\\'")}'`);
        if (audioOnly)
          qParts.push(
            "(mimeType contains 'audio/' or mimeType contains 'video/' or name contains '.mp3' or name contains '.m4a' or name contains '.wav' or name contains '.ogg' or name contains '.opus' or name contains '.aac' or name contains '.flac')"
          );
        const url = new URL(`${GATEWAY}/drive/v3/files`);
        url.searchParams.set('q', qParts.join(' and '));
        url.searchParams.set(
          'fields',
          'nextPageToken, files(id, name, mimeType, size, modifiedTime, iconLink, webViewLink, parents)'
        );
        url.searchParams.set('pageSize', String(pageSize));
        url.searchParams.set('orderBy', 'folder,modifiedTime desc');
        if (pageToken) url.searchParams.set('pageToken', pageToken);

        const res = await fetch(url, { headers: authHeaders() });
        const body = await res.text();
        if (!res.ok) return json({ error: 'drive list failed', status: res.status, body }, 500);
        return new Response(body, {
          headers: { ...extraCors, 'Content-Type': 'application/json' },
        });
      }

      case 'download': {
        const { fileId } = params;
        if (!fileId) return json({ error: 'fileId required' }, 400);
        const res = await fetch(
          `${GATEWAY}/drive/v3/files/${fileId}?alt=media`,
          { headers: authHeaders() }
        );
        if (!res.ok) {
          const t = await res.text();
          return json({ error: 'download failed', status: res.status, body: t }, 500);
        }
        const buf = await res.arrayBuffer();
        const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        return json({
          base64: b64,
          contentType: res.headers.get('content-type') || 'application/octet-stream',
          size: buf.byteLength,
        });
      }

      case 'upload': {
        const { name, mimeType = 'text/plain', base64, parents } = params;
        if (!name || !base64) return json({ error: 'name & base64 required' }, 400);
        const metadata: Record<string, unknown> = { name, mimeType };
        if (parents?.length) metadata.parents = parents;

        // More reliable flow with the connector gateway:
        // 1) create metadata-only file, 2) upload media bytes via PATCH.
        const createRes = await fetch(
          `${GATEWAY}/drive/v3/files?fields=id,name,webViewLink`,
          {
            method: 'POST',
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(metadata),
          }
        );
        const createTxt = await createRes.text();
        if (!createRes.ok) {
          return json({ error: 'upload create failed', status: createRes.status, body: createTxt }, 500);
        }

        const created = JSON.parse(createTxt);
        const fileId = created?.id;
        if (!fileId) {
          return json({ error: 'upload create missing file id', body: createTxt }, 500);
        }

        const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const mediaRes = await fetch(
          `${GATEWAY}/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,name,webViewLink`,
          {
            method: 'PATCH',
            headers: { ...authHeaders(), 'Content-Type': mimeType },
            body: bin,
          }
        );
        const mediaTxt = await mediaRes.text();
        if (!mediaRes.ok) {
          return json({ error: 'upload media failed', status: mediaRes.status, body: mediaTxt, fileId }, 500);
        }

        return new Response(mediaTxt, {
          headers: { ...extraCors, 'Content-Type': 'application/json' },
        });
      }

      case 'createFolder': {
        const { name, parents } = params;
        const metadata: Record<string, unknown> = {
          name,
          mimeType: 'application/vnd.google-apps.folder',
        };
        if (parents?.length) metadata.parents = parents;
        const res = await fetch(`${GATEWAY}/drive/v3/files?fields=id,name,webViewLink`, {
          method: 'POST',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify(metadata),
        });
        const txt = await res.text();
        if (!res.ok) return json({ error: 'createFolder failed', body: txt }, 500);
        return new Response(txt, {
          headers: { ...extraCors, 'Content-Type': 'application/json' },
        });
      }

      case 'findByName': {
        const { name, parentId } = params;
        if (!name) return json({ error: 'name required' }, 400);
        const safeName = String(name).replace(/'/g, "\\'");
        const qParts = [`name = '${safeName}'`, 'trashed = false'];
        if (parentId) qParts.push(`'${parentId}' in parents`);
        const url = new URL(`${GATEWAY}/drive/v3/files`);
        url.searchParams.set('q', qParts.join(' and '));
        url.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime,size,webViewLink)');
        url.searchParams.set('pageSize', '20');
        const res = await fetch(url, { headers: authHeaders() });
        const body = await res.text();
        if (!res.ok) return json({ error: 'find failed', status: res.status, body }, 500);
        return new Response(body, {
          headers: { ...extraCors, 'Content-Type': 'application/json' },
        });
      }

      case 'updateContent': {
        const { fileId, mimeType = 'text/plain', base64 } = params;
        if (!fileId || !base64) return json({ error: 'fileId & base64 required' }, 400);
        const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const res = await fetch(
          `${GATEWAY}/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,name,webViewLink`,
          {
            method: 'PATCH',
            headers: { ...authHeaders(), 'Content-Type': mimeType },
            body: bin,
          }
        );
        const txt = await res.text();
        if (!res.ok) return json({ error: 'update failed', status: res.status, body: txt }, 500);
        return new Response(txt, {
          headers: { ...extraCors, 'Content-Type': 'application/json' },
        });
      }

      case 'delete': {
        const { fileId } = params;
        if (!fileId) return json({ error: 'fileId required' }, 400);
        const res = await fetch(`${GATEWAY}/drive/v3/files/${fileId}`, {
          method: 'DELETE',
          headers: authHeaders(),
        });
        const txt = await res.text();
        if (!res.ok) return json({ error: 'delete failed', status: res.status, body: txt }, 500);
        return json({ success: true });
      }

      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
