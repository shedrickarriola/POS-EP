'use server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const getApiKey = () => process.env.GEMINI_API_KEY;

export async function parseInvoiceImage(base64Data: string, mimeType: string) {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  // 1. TYPE GUARD: Prevents "e.split is not a function"
  if (typeof base64Data !== 'string') {
    console.error(
      'FRONTEND ERROR: base64Data must be a string. Received:',
      typeof base64Data
    );
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

    // 2. CLEAN DATA: Get the raw string after the comma
    const pureBase64 = base64Data.includes(',')
      ? base64Data.split(',')
      : base64Data;

    const result = await model.generateContent([
      {
        text: 'Extract pharmacy items: item_name, qty, invoice_price. Return JSON array.',
      },
      {
        inlineData: {
          data: pureBase64,
          mimeType: mimeType.toLowerCase().trim(),
        },
      },
    ]);

    const response = await result.response;
    return JSON.parse(response.text());
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
      `Extract pharmacy items as JSON array (item_name, qty): ${pastedText}`
    );
    const response = await result.response;
    return JSON.parse(response.text());
  } catch (error: any) {
    console.error('TEXT SCAN ERROR:', error.message);
    return null;
  }
}
