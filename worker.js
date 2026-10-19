/* ==========================================================================
   >>> ANCHOR: JWT_CRYPTO_ENGINE_START <<<
   ========================================================================== */
function base64url(source) {
  let encoded = btoa(String.fromCharCode(...new Uint8Array(source)));
  return encoded.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function stringToBase64url(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getGoogleAccessToken(clientEmail, rawPrivateKey) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  
  const claim = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = stringToBase64url(JSON.stringify(header));
  const encodedClaim = stringToBase64url(JSON.stringify(claim));
  const tokenInput = `${encodedHeader}.${encodedClaim}`;

  let cleanKey = rawPrivateKey
    .replace(/^["']|["']$/g, '')
    .replace(/\\n/g, '')
    .replace(/\r/g, '')
    .replace(/\n/g, '')
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');

  while (cleanKey.length % 4 !== 0) {
    cleanKey += '=';
  }

  const binaryDer = Uint8Array.from(atob(cleanKey), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryDer.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(tokenInput)
  );

  const signedJwt = `${tokenInput}.${base64url(signature)}`;

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${signedJwt}`,
  });

  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok) {
    throw new Error(`Google Auth Failed: ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token;
}
/* ==========================================================================
   >>> ANCHOR: JWT_CRYPTO_ENGINE_END <<<
   ========================================================================== */


/* ==========================================================================
   >>> ANCHOR: SHEETS_LOGGING_HELPER_START <<<
   ========================================================================== */
async function appendToSheet(accessToken, sheetId, rows) {
  if (!sheetId || !rows || !rows.length) return new Response(JSON.stringify({ ok: true }), { status: 200 });

  const range = 'A:E';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;
  
  return await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: rows }),
  });
}
/* ==========================================================================
   >>> ANCHOR: SHEETS_LOGGING_HELPER_END <<<
   ========================================================================== */


/* ==========================================================================
   >>> ANCHOR: SECURITY_GATE_ROUTER_START <<<
   ========================================================================== */
export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-App-Key',
      'Content-Type': 'application/json',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
    }

    // Edge Security: Accept master CLIENT_ACCESS_KEY or colleague SHARED_APP_KEY
    const clientPass = request.headers.get('X-App-Key');
    const isMaster = env.CLIENT_ACCESS_KEY && clientPass === env.CLIENT_ACCESS_KEY;
    const isColleague = env.SHARED_APP_KEY && clientPass === env.SHARED_APP_KEY;

    if (!isMaster && !isColleague) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid or missing App Key' }), {
        status: 401,
        headers: corsHeaders
      });
    }

    try {
      const body = await request.json().catch(() => ({}));
      const apiKey = env.GEMINI_API_KEY;

      // Colleague keys are restricted strictly to educational tools
      if (isColleague && !isMaster && body.action !== 'ORTHO_MAP') {
        return new Response(JSON.stringify({ error: 'Forbidden: Passcode does not grant access to this service' }), {
          status: 403,
          headers: corsHeaders
        });
      }
/* ==========================================================================
   >>> ANCHOR: SECURITY_GATE_ROUTER_END <<<
   ========================================================================== */

/* ==========================================================================
   >>> ANCHOR: ROUTE_INSERT_CALENDAR_SHEETS_START <<<
   ========================================================================== */
      if (body.action === 'INSERT') {
        const events = Array.isArray(body.events) ? body.events : [];
        if (!events.length) {
          return new Response(JSON.stringify({ error: 'No events provided' }), { status: 400, headers: corsHeaders });
        }

        const accessToken = await getGoogleAccessToken(env.GOOGLE_CLIENT_EMAIL, env.GOOGLE_PRIVATE_KEY);
        const calendarId = encodeURIComponent(env.GOOGLE_CALENDAR_ID);

        const sheetRows = [];
        const timestamp = new Date().toISOString();

        for (const ev of events) {
          const gcalEvent = {
            summary: ev.title || 'Untitled Task',
            description: ev.steps ? ev.steps.join('\n') : (ev.description || ''),
            location: ev.location || '',
            colorId: ev.color_id || '9',
            start: {
              dateTime: `${ev.date}T${ev.start_time}:00`,
              timeZone: 'America/Chicago',
            },
            end: {
              dateTime: `${ev.date}T${ev.end_time || ev.start_time}:00`,
              timeZone: 'America/Chicago',
            },
          };

          const calRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(gcalEvent),
          });

          if (!calRes.ok) {
            const calErr = await calRes.text();
            return new Response(JSON.stringify({ error: `Calendar API Error (${calRes.status}): ${calErr}` }), { status: 500, headers: corsHeaders });
          }

          sheetRows.push([
            timestamp,
            ev.date,
            `${ev.start_time} - ${ev.end_time || ev.start_time}`,
            ev.title || 'Untitled Task',
            ev.color_id || '9'
          ]);
        }

        if (env.GOOGLE_SHEET_ID) {
          const sheetRes = await appendToSheet(accessToken, env.GOOGLE_SHEET_ID, sheetRows);
          if (!sheetRes.ok) {
            const sheetErrText = await sheetRes.text();
            return new Response(JSON.stringify({ error: `Google Sheets API Error (${sheetRes.status}): ${sheetErrText}` }), { status: 500, headers: corsHeaders });
          }
        }

        return new Response(JSON.stringify({ success: true, count: events.length }), { status: 200, headers: corsHeaders });
      }
      /* ==========================================================================
         >>> ANCHOR: ROUTE_INSERT_CALENDAR_SHEETS_END <<<
         ========================================================================== */

/* ==========================================================================
         >>> ANCHOR: ROUTE_CODE_SNAPSHOT_START <<<
         ========================================================================== */
      if (body.action === 'SAVE_SNAPSHOT') {
        const { note, anchorName, payload, author } = body;
        if (!env.GOOGLE_SHEET_ID) {
          return new Response(JSON.stringify({ error: 'Missing GOOGLE_SHEET_ID' }), { status: 400, headers: corsHeaders });
        }

        const accessToken = await getGoogleAccessToken(env.GOOGLE_CLIENT_EMAIL, env.GOOGLE_PRIVATE_KEY);
        const timestamp = new Date().toISOString();

        // Target the CodeSnapshots tab specifically
        const range = 'CodeSnapshots!A:E';
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;

        const sheetRes = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            values: [[timestamp, note || 'Manual snapshot', anchorName || 'FULL_FILE', payload || '', author || 'Client']]
          }),
        });

        if (!sheetRes.ok) {
          const errText = await sheetRes.text();
          return new Response(JSON.stringify({ error: `Snapshot error: ${errText}` }), { status: 500, headers: corsHeaders });
        }

        return new Response(JSON.stringify({ success: true, timestamp }), { status: 200, headers: corsHeaders });
      }
      /* ==========================================================================
         >>> ANCHOR: ROUTE_CODE_SNAPSHOT_END <<<
         ========================================================================== */

/* ==========================================================================
         >>> ANCHOR: ROUTE_HOPPER_PARSE_START <<<
         ========================================================================== */
      if (body.action === 'HOPPER_PARSE') {
        const text = body.text || '';
        const audioData = body.audioData || null;
        const mimeType = body.mimeType || 'audio/mp4';

        if (!text.trim() && !audioData) {
          return new Response(JSON.stringify({ items: [] }), { status: 200, headers: corsHeaders });
        }

        // Use the exact model name verified across your other working endpoints
        const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

        const contentParts = [];
        if (audioData) {
          // Normalize iOS mimeType if needed (remove codec flags for Gemini inlineData)
          const cleanMime = mimeType.split(';')[0];
          contentParts.push({
            inlineData: {
              mimeType: cleanMime,
              data: audioData
            }
          });
        }
        if (text.trim()) {
          contentParts.push({ text: `User text notes: ${text}` });
        }

        const payload = {
          contents: [{ parts: contentParts }],
          systemInstruction: {
            parts: [{
              text: `You are an ADHD executive-function intake engine.
The user provides a stream-of-consciousness brain dump (via spoken audio or raw text) of thoughts, obligations, chores, or errands.
Your job:
1. Listen closely and accurately transcribe the user's spoken words.
2. Separate distinct, actionable items into clean, concise phrases.
3. Do NOT schedule them. Do NOT assign times, dates, or durations.
Output strictly valid JSON matching this schema:
{"items": ["First distinct item", "Second distinct item"]}`
            }]
          },
          generationConfig: {
            response_mime_type: 'application/json',
            response_schema: {
              type: 'OBJECT',
              properties: {
                items: {
                  type: 'ARRAY',
                  items: { type: 'STRING' }
                }
              },
              required: ['items']
            }
          }
        };

        const geminiRes = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!geminiRes.ok) {
          const errText = await geminiRes.text();
          return new Response(JSON.stringify({ error: `Gemini API error (${geminiRes.status}): ${errText}` }), { 
            status: geminiRes.status, 
            headers: corsHeaders 
          });
        }

        const geminiData = await geminiRes.json();
        const outputJson = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '{"items":[]}';
        return new Response(outputJson, { status: 200, headers: corsHeaders });
      }
      /* ==========================================================================
         >>> ANCHOR: ROUTE_HOPPER_PARSE_END <<<
         ========================================================================== */
         
      /* ==========================================================================
         >>> ANCHOR: ROUTE_FORGE_CHAT_BACKEND_START <<<
         ========================================================================== */
      if (body.action === 'DEV_FORGE') {
        const history = Array.isArray(body.history) && body.history.length > 0
          ? body.history
          : [{ role: 'user', parts: [{ text: body.prompt || 'Hello' }] }];

        const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

        const payload = {
          contents: history,
          systemInstruction: {
            parts: [{
              text: `You are Gemini, an authentic, adaptive, and witty engineering collaborator running inside the user's personal task scheduler.

THE ANCHOR PROTOCOL & SELECTOR INTEGRITY (STRICT CODE DELIVERY NORM):
The user maintains a single-file 'index.html' and updates it via search-and-replace.
Whenever you provide code changes, you MUST follow these non-negotiable rules:

"When emitting the CSS_THEME_AND_LAYOUT anchor block, you MUST wrap the CSS rules inside <style> and </style> tags. Never output bare CSS directly between the HTML anchor comments."

1. Variable & Selector Integrity:
   - When updating CSS, NEVER rename, delete, or invent new CSS variable names or class selectors.
   - You MUST retain existing variable names (--bg, --card-bg, --border, --text, --text-muted, --primary, --primary-hover, --tag-11, --tag-8, --tag-2, --tag-9, etc.).
   - You MUST retain all functional selectors (.container, .task-card, .task-header, .sort-controls, .btn-arrow, .forge-pill, .forge-drawer, etc.) so layout and drawer controls never break.

2. Locate which anchor section in 'index.html' owns the change:
   - CSS & Layout:
     /* ==========================================================================
        >>> ANCHOR: CSS_THEME_AND_LAYOUT_START <<<
        ========================================================================== */
     ...
     /* ==========================================================================
        >>> ANCHOR: CSS_THEME_AND_LAYOUT_END <<<
        ========================================================================== */

   - Task Card Rendering:
     /* ==========================================================================
        >>> ANCHOR: TASK_CARD_RENDER_START <<<
        ========================================================================== */
     ...
     /* ==========================================================================
        >>> ANCHOR: TASK_CARD_RENDER_END <<<
        ========================================================================== */

   - Task Sorting Logic:
     /* ==========================================================================
        >>> ANCHOR: TASK_SORTING_LOGIC_START <<<
        ========================================================================== */
     ...
     /* ==========================================================================
        >>> ANCHOR: TASK_SORTING_LOGIC_END <<<
        ========================================================================== */

   - API Parsing & Calendar/Sheets Save:
     /* ==========================================================================
        >>> ANCHOR: TASK_API_PARSING_AND_SAVE_START <<<
        ========================================================================== */
     ...
     /* ==========================================================================
        >>> ANCHOR: TASK_API_PARSING_AND_SAVE_END <<<
        ========================================================================== */

   - Forge Chat Client:
     /* ==========================================================================
        >>> ANCHOR: FORGE_CHAT_CLIENT_START <<<
        ========================================================================== */
     ...
     /* ==========================================================================
        >>> ANCHOR: FORGE_CHAT_CLIENT_END <<<
        ========================================================================== */

3. In your response:
   - Provide a concise 1-2 sentence explanation of the ergonomic/visual change.
   - Instruct the user: "Search for >>> ANCHOR: [NAME]_START <<< and replace through >>> ANCHOR: [NAME]_END <<< with:"
   - Render the complete replacement block wrapped in the exact start and end anchor banners.
   - For quick CSS/JS experiments, wrap valid code in \`\`\`css or \`\`\`javascript blocks so the client's '⚡ Apply Patch Live' and '📋 Copy Code Block' buttons function immediately.`
            }]
          }
        };

        const devRes = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const devData = await devRes.json();
        if (!devRes.ok) {
          return new Response(JSON.stringify({ error: devData.error?.message || 'Gemini error' }), { status: devRes.status, headers: corsHeaders });
        }

        const replyText = devData.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.';
        return new Response(JSON.stringify({ response: replyText }), { status: 200, headers: corsHeaders });
      }
      /* ==========================================================================
         >>> ANCHOR: ROUTE_FORGE_CHAT_BACKEND_END <<<
         ========================================================================== */

/* ==========================================================================
         >>> ANCHOR: ROUTE_ORTHO_MAP_START <<<
         ========================================================================== */
      if (body.action === 'ORTHO_MAP') {
        const words = Array.isArray(body.words) ? body.words : (body.word ? [body.word] : []);
        if (!words.length) {
          return new Response(JSON.stringify({ results: [] }), { status: 200, headers: corsHeaders });
        }

        const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

        const payload = {
          contents: [{
            parts: [{
              text: `Analyze and orthographically map the following word list for evidence-based reading instruction:
${JSON.stringify(words)}`
            }]
          }],
          systemInstruction: {
            parts: [{
              text: `You are an expert reading science and LETRS-aligned phonics specialist.
Perform orthographic mapping on the supplied word list.
For each word, identify:
1. phonemes (spoken sound segments using slash notation, e.g., /k/ /æ/ /t/)
2. graphemes (corresponding letter or letter team for each phoneme box)
3. syllable_types (e.g., closed, open, VCe, vowel team, r-controlled, consonant-le)
4. irregular_parts (heart sounds / non-decodable phoneme-grapheme correspondences, if any)

Output strictly valid JSON matching the requested schema.`
            }]
          },
          generationConfig: {
            response_mime_type: 'application/json',
            response_schema: {
              type: 'OBJECT',
              properties: {
                results: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      word: { type: 'STRING' },
                      phonemes: { type: 'ARRAY', items: { type: 'STRING' } },
                      graphemes: { type: 'ARRAY', items: { type: 'STRING' } },
                      syllable_types: { type: 'ARRAY', items: { type: 'STRING' } },
                      irregular_parts: { type: 'ARRAY', items: { type: 'STRING' } }
                    },
                    required: ['word', 'phonemes', 'graphemes', 'syllable_types']
                  }
                }
              },
              required: ['results']
            }
          }
        };

        const geminiRes = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!geminiRes.ok) {
          const errText = await geminiRes.text();
          return new Response(JSON.stringify({ error: `Gemini API error (${geminiRes.status}): ${errText}` }), {
            status: geminiRes.status,
            headers: corsHeaders
          });
        }

        const geminiData = await geminiRes.json();
        const outputJson = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '{"results":[]}';
        return new Response(outputJson, { status: 200, headers: corsHeaders });
      }
      /* ==========================================================================
         >>> ANCHOR: ROUTE_ORTHO_MAP_END <<<
         ========================================================================== */

      /* ==========================================================================
         >>> ANCHOR: ROUTE_TASK_SEQUENCING_START <<<
         ========================================================================== */
      const prompt = body.prompt;
      if (!prompt) {
        return new Response(JSON.stringify({ error: 'Missing prompt' }), { status: 400, headers: corsHeaders });
      }

      const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;
      const currentDate = new Date().toISOString().split('T')[0];

      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: {
          parts: [{
            text: `You are an executive function scheduling engine. Reference today's date: ${currentDate}. Timezone: America/Chicago.
Parse natural language task brain dumps into a clear, sorted list of sequential events with realistic time allocations:
1. Assign start_time and end_time (HH:MM 24-hour format). Keep default durations realistic (15m, 30m, 45m).
2. Assign color_id:
   - "11" (Tomato): High-friction, dreaded administrative tasks
   - "8" (Graphite): Quick errands, maintenance, chores
   - "2" (Sage): Restorative activities, workouts, breaks
   - "9" (Blueberry): Fixed appointments or commitments
3. If an item carries noticeable initiation friction, provide 3 short, concrete starter steps in the 'steps' array to lower activation resistance.`
          }]
        },
        generationConfig: {
          response_mime_type: 'application/json',
          response_schema: {
            type: 'OBJECT',
            properties: {
              events: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    title: { type: 'STRING' },
                    date: { type: 'STRING', description: 'YYYY-MM-DD' },
                    start_time: { type: 'STRING', description: 'HH:MM' },
                    end_time: { type: 'STRING', description: 'HH:MM' },
                    duration_minutes: { type: 'INTEGER' },
                    color_id: { type: 'STRING', enum: ['11', '8', '2', '9'] },
                    friction_level: { type: 'STRING', enum: ['low', 'medium', 'high'] },
                    steps: {
                      type: 'ARRAY',
                      items: { type: 'STRING' }
                    }
                  },
                  required: ['title', 'date', 'start_time', 'end_time', 'duration_minutes', 'color_id', 'friction_level']
                }
              }
            },
            required: ['events']
          }
        }
      };

      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const resText = await res.text();
      if (!res.ok) {
        return new Response(resText, { status: res.status, headers: corsHeaders });
      }

      const parsed = JSON.parse(resText);
      const outputText = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '{"events":[]}';
      return new Response(outputText, { status: 200, headers: corsHeaders });
      /* ==========================================================================
         >>> ANCHOR: ROUTE_TASK_SEQUENCING_END <<<
         ========================================================================== */

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message || 'Worker failure' }), { status: 500, headers: corsHeaders });
    }
  }
};
