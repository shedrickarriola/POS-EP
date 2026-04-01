'use server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const getApiKey = () => process.env.GEMINI_API_KEY;

export async function parseInvoiceImage(base64Data: string, mimeType: string) {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  if (typeof base64Data !== 'string') {
    console.error('SERVER ERROR: base64Data is not a string');
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

    // ✅ THE FIX: We need index to get the pure string data
    // .split(',') creates a list; picks the actual base64 text
    const pureBase64 = base64Data.includes(',')
      ? base64Data.split(',')
      : base64Data;

    // Safety check: Ensure the string isn't empty after splitting
    if (!pureBase64 || pureBase64.length < 10) {
      console.error('SERVER ERROR: Cleaned base64 string is empty');
      return null;
    }

    const result = await model.generateContent([
      {
        text: 'Extract pharmacy items (item_name, qty, invoice_price) from this image. Return ONLY a JSON array.',
      },
      {
        inlineData: {
          data: pureBase64, // Now strictly a STRING, not a list
          mimeType: mimeType.toLowerCase().trim() || 'image/jpeg',
        },
      },
    ]);

    const response = await result.response;
    const text = response.text();
    return JSON.parse(text);
  } catch (error: any) {
    // If you see "400" here, check if the image is too large (>4MB)
    console.error('IMAGE SCAN ERROR:', error.message);
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
      `Extract pharmacy items as JSON array with keys (item_name, qty, invoice_price): ${pastedText}`
    );
    const response = await result.response;
    return JSON.parse(response.text());
  } catch (error: any) {
    console.error('TEXT SCAN ERROR:', error.message);
    return null;
  }
}
