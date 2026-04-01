'use server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const getApiKey = () => process.env.GEMINI_API_KEY;

export async function parseInvoiceImage(base64Data: string, mimeType: string) {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error('API Key missing');
    return null;
  }

  if (typeof base64Data !== 'string') {
    console.error('Data is not a string');
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

    // ✅ FIX: Use to get the string, not the array
    const pureBase64 = base64Data.includes(',')
      ? base64Data.split(',') 
      : base64Data;

    // Extra safety: If split failed or string is empty, don't call the API
    if (!pureBase64) {
      console.error('Base64 extraction failed');
      return null;
    }

    const result = await model.generateContent([
      {
        text: 'Extract pharmacy items: item_name, qty, invoice_price. Return a JSON array of objects.',
      },
      {
        inlineData: {
          data: pureBase64, // Now strictly a string
          mimeType: mimeType.toLowerCase().trim() || 'image/jpeg',
        },
      },
    ]);

    const response = await result.response;
    const text = response.text();
    return JSON.parse(text);

  } catch (error: any) {
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