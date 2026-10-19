'use server';
import { GoogleGenAI } from '@google/genai';

// gemini-2.5-flash reached its scheduled shutdown on Oct 16, 2026.
// Keep the model name in one place so the next migration is a one-line change.
const MODEL = 'gemini-3.5-flash';

type ScanError = { error: string };

const getClient = (): GoogleGenAI | null => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
};

// Strips ```json fences in case the model wraps its output despite JSON mode.
const parseJsonArray = (raw: string | undefined): any[] | ScanError => {
  const text = (raw ?? '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  if (!text) return { error: 'AI returned an empty response.' };

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    // Some responses come back as { items: [...] }
    if (Array.isArray(parsed?.items)) return parsed.items;
    return { error: 'AI response was not a list of items.' };
  } catch {
    return { error: `AI returned invalid JSON: ${text.slice(0, 200)}` };
  }
};

export async function parseInvoiceImage(
  base64Data: string,
  mimeType: string
): Promise<any[] | ScanError> {
  const ai = getClient();
  if (!ai) {
    console.error('GEMINI_API_KEY is missing');
    return { error: 'GEMINI_API_KEY is missing on the server.' };
  }

  if (typeof base64Data !== 'string' || base64Data.length < 50) {
    return { error: 'Invalid image data (too short or not a string).' };
  }

  // Strip the "data:image/jpeg;base64," prefix if present
  const pureBase64 = base64Data.includes(',')
    ? base64Data.split(',')[1]
    : base64Data;

  if (!pureBase64 || pureBase64.length < 20) {
    return { error: 'Image data is empty after cleaning.' };
  }

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: 'Extract pharmacy items (item_name, qty, invoice_price) from this image. Return ONLY a valid JSON array of objects. Do not include any extra text.',
            },
            {
              inlineData: {
                data: pureBase64.trim(),
                mimeType: mimeType?.toLowerCase().trim() || 'image/jpeg',
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });

    return parseJsonArray(response.text);
  } catch (error: any) {
    const msg = error?.message || String(error);
    console.error('IMAGE SCAN ERROR:', msg);
    return { error: msg };
  }
}

export async function parseInvoiceText(
  pastedText: string
): Promise<any[] | ScanError> {
  const ai = getClient();
  if (!ai) return { error: 'GEMINI_API_KEY is missing on the server.' };

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: `Extract pharmacy items as JSON array with keys (item_name, qty, invoice_price): ${pastedText}`,
      config: { responseMimeType: 'application/json' },
    });

    return parseJsonArray(response.text);
  } catch (error: any) {
    const msg = error?.message || String(error);
    console.error('TEXT SCAN ERROR:', msg);
    return { error: msg };
  }
}
