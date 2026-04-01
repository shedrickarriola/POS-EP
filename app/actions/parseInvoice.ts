'use server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const getApiKey = () => process.env.GEMINI_API_KEY;

export async function parseInvoiceImage(base64Data: string, mimeType: string) {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error('GEMINI_API_KEY is missing');
    return null;
  }

  if (typeof base64Data !== 'string' || base64Data.length < 50) {
    console.error(
      'SERVER ERROR: Invalid base64 input (too short or not a string)'
    );
    return null;
  }

  try {
    // ✅ Properly extract only the pure base64 part
    let pureBase64 = base64Data;

    if (base64Data.includes(',')) {
      pureBase64 = base64Data.split(',')[1]; // Take everything after the comma
    }

    // Extra safety
    if (!pureBase64 || pureBase64.length < 20) {
      console.error(
        'SERVER ERROR: Cleaned base64 string is empty or too short'
      );
      return null;
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });

    const result = await model.generateContent([
      {
        text: 'Extract pharmacy items (item_name, qty, invoice_price) from this image. Return ONLY a valid JSON array of objects. Do not include any extra text.',
      },
      {
        inlineData: {
          data: pureBase64.trim(), // Must be pure base64 string
          mimeType: mimeType.toLowerCase().trim() || 'image/jpeg',
        },
      },
    ]);

    const response = await result.response;
    const text = response.text().trim();

    if (!text) return null;

    return JSON.parse(text);
  } catch (error: any) {
    console.error('IMAGE SCAN ERROR:', error.message || error);
    if (error?.message?.includes('base64')) {
      console.error(
        'Base64 issue detected. Check how the data is being sent from client.'
      );
    }
    return null;
  }
}

export async function parseInvoiceText(pastedText: string) {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
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
