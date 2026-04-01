'use server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Server-side only: Key must be in Vercel Dashboard
const getApiKey = () => process.env.GEMINI_API_KEY;

export async function parseInvoiceImage(base64Data: string, mimeType: string) {
  const apiKey = getApiKey();

  if (!apiKey) {
    console.error('SERVER ERROR: GEMINI_API_KEY is not defined in Vercel');
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

    // 1. Ensure data is a pure string and NOT an array
    const sanitizedData = base64Data.includes(',') 
      ? base64Data.split(',') 
      : base64Data;

    // 2. Ensure MIME type is clean and supported (e.g. image/jpeg)
    const sanitizedMimeType = mimeType.toLowerCase().trim();

    const prompt = `
      Extract pharmacy invoice items: "item_name" (string), "qty" (number), "invoice_price" (number). 
      Handle pharmaceutical shorthand. Return ONLY a JSON array.
    `;

    // 3. The "Legacy" Array Format: This is the most stable way to prevent "cannot start list"
    const result = await model.generateContent([
      prompt, // Pass as a direct string part
      {
        inlineData: {
          data: sanitizedData, 
          mimeType: sanitizedMimeType,
        },
      },
    ]);

    const response = await result.response;
    const text = response.text();

    // With responseMimeType set to application/json, parse directly
    return JSON.parse(text);

  } catch (error: any) {
    console.error('IMAGE SCAN ERROR:', error.message);
    // If the error persists, it's almost certainly the format of 'base64Data' string itself
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

    const prompt = `Extract items from this text. Return ONLY a JSON array with keys "item_name" and "qty". Text: ${pastedText}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return JSON.parse(response.text());
  } catch (error: any) {
    console.error('TEXT SCAN ERROR:', error.message);
    return null;
  }
}