'use server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Server-side only: Ensure GEMINI_API_KEY is set in Vercel Project Settings
const getApiKey = () => process.env.GEMINI_API_KEY;

/**
 * FIXED: Returns the actual Base64 STRING at index 1.
 * Previous version was returning the whole array.
 */
const cleanBase64 = (base64String: string): string => {
  if (base64String.includes(',')) {
    // split returns [header, data]. We ONLY want the data string at index 1.
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

    // sanitizedData is now GUARANTEED to be a string
    const sanitizedData = cleanBase64(base64Data);

    const result = await model.generateContent([
      { text: prompt },
      {
        inlineData: {
          data: sanitizedData, 
          mimeType: mimeType,
        },
      },
    ]);

    const response = await result.response;
    const text = response.text();

    // With responseMimeType: 'application/json', no regex cleaning needed
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