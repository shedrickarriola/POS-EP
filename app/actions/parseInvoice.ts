'use server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Server-side only: Ensure GEMINI_API_KEY is set in Vercel Project Settings
const getApiKey = () => process.env.GEMINI_API_KEY;

/**
 * FIXED: Returns the actual Base64 STRING at index 1, not the whole array.
 */
const cleanBase64 = (base64String: string): string => {
  if (base64String.includes(',')) {
    // is the 'data:image/jpeg;base64' header, is the actual base64 string
    return base64String.split(','); 
  }
  return base64String;
};

export async function parseInvoiceImage(base64Data: string, mimeType: string) {
  const apiKey = getApiKey();

  if (!apiKey) {
    console.error('SERVER ERROR: API Key missing in environment variables');
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

    const prompt = `
      Extract items from this pharmacy invoice. 
      Return ONLY a JSON array of objects with keys: 
      "item_name" (string), "qty" (number), "invoice_price" (number).
      Handle pharmaceutical shorthand (e.g., 'Amox' -> 'Amoxicillin').
    `;

    // CRITICAL: Get the raw string, NOT the array from .split()
    const sanitizedData = cleanBase64(base64Data);

    // Call the model with explicit Part objects
    const result = await model.generateContent([
      { text: prompt },
      {
        inlineData: {
          data: sanitizedData, // This is now a pure String
          mimeType: mimeType,
        },
      },
    ]);

    const response = await result.response;
    const text = response.text();

    // With responseMimeType: 'application/json', the result is clean JSON
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

    const prompt = `Extract pharmacy items from this text. Return ONLY a JSON array of objects with keys: "item_name" and "qty". Text: ${pastedText}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;

    return JSON.parse(response.text());
  } catch (error: any) {
    console.error('TEXT SCAN ERROR:', error.message);
    return null;
  }
}