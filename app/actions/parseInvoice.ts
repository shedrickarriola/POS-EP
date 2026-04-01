'use server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const getApiKey = () => process.env.GEMINI_API_KEY;

export async function parseInvoiceImage(base64Data: string, mimeType: string) {
  const apiKey = getApiKey();

  if (!apiKey) {
    console.error('SERVER ERROR: API Key missing in Vercel environment');
    return null;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });

    // 1. HARD-STRIP THE BASE64: Ensure this is a PURE string.
    // We use .pop() to guarantee we get the string, not an array.
    const pureBase64 = base64Data.split(',').pop() || '';

    // 2. STABILIZE MIME TYPE: API expects lowercase 'image/jpeg' etc.
    const cleanMime = mimeType.toLowerCase().trim();

    // 3. THE "STRICT" PAYLOAD: Each part is a clearly defined object.
    const result = await model.generateContent([
      {
        text: "Extract pharmacy items (item_name, qty, invoice_price) from this invoice. Return ONLY a JSON array."
      },
      {
        inlineData: {
          data: pureBase64, // Must be a raw string
          mimeType: cleanMime,
        },
      }
    ]);

    const response = await result.response;
    const text = response.text();

    // Since we set responseMimeType: 'application/json', we parse directly.
    return JSON.parse(text);

  } catch (error: any) {
    console.error('IMAGE SCAN ERROR:', error.message);
    // If you see "400" again, check if 'base64Data' is empty on the frontend.
    return null;
  }
}

export async function parseInvoiceText(pastedText: string) {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: { responseMimeType: 'application/json' },
    });

    const result = await model.generateContent(
      `Extract pharmacy items as JSON array (item_name, qty): ${pastedText}`
    );
    const response = await result.response;
    return JSON.parse(response.text());
  } catch (error: any) {
    console.error('TEXT SCAN ERROR:', error.message);
    return null;
  }
}