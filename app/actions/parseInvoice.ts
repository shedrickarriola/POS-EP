'use server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Server-side only: Ensure GEMINI_API_KEY is set in Vercel Project Settings
const getApiKey = () => process.env.GEMINI_API_KEY;

/**
 * FIXED: Returns the actual Base64 STRING, not an array.
 */
const cleanBase64 = (base64String: string): string => {
  if (base64String.includes(',')) {
    // split() returns [header, data]. We need.
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

    // Process the image data to ensure it's a raw string
    const sanitizedData = cleanBase64(base64Data);

    // Call the model with explicit Part objects
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

    // With responseMimeType: 'application/json', result is usually clean JSON
    return JSON.parse(text);

  } catch (error: any) {
    console.error('IMAGE SCAN ERROR:', error.message);
    // Log details if it's still a 400 to see if the payload structure changed
    if (error.message.includes('400')) {
       console.error('Payload Issue: Ensure mimeType matches the file (e.g., image/jpeg)');
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