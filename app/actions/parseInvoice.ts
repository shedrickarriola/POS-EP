'use server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const getApiKey = () => process.env.GEMINI_API_KEY;

export async function parseInvoiceImage(base64Data: string, mimeType: string) {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error('GEMINI_API_KEY is missing in environment variables');
    return null;
  }

  if (typeof base64Data !== 'string' || base64Data.length < 50) {
    console.error('SERVER ERROR: Invalid base64 input');
    return null;
  }

  try {
    // Clean base64 (remove data URL prefix if present)
    let pureBase64 = base64Data;
    if (base64Data.includes(',')) {
      pureBase64 = base64Data.split(',')[1];
    }

    if (!pureBase64 || pureBase64.length < 20) {
      console.error('SERVER ERROR: Cleaned base64 is empty or too short');
      return null;
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash', // ← Updated model
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });

    const result = await model.generateContent([
      {
        text: `Extract all pharmacy/medicine items from this invoice image.
Return ONLY a valid JSON array of objects. Each object must have exactly these keys:
- item_name (string)
- qty (number)
- invoice_price (number)

Do not add any extra text, explanations, or markdown.`,
      },
      {
        inlineData: {
          data: pureBase64.trim(),
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
    // Optional: log more details in development
    if (process.env.NODE_ENV === 'development') {
      console.error(error);
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
      model: 'gemini-2.5-flash',
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
