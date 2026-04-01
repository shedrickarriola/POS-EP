'use server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// In 'use server', we only need the private GEMINI_API_KEY from Vercel env
const getApiKey = () => process.env.GEMINI_API_KEY;

/**
 * Utility to strip the Data URL prefix if it exists
 */
const cleanBase64 = (base64String: string) => {
  if (base64String.includes(',')) {
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

    // CRITICAL: We pass the prompt as a string and the image as a Part object.
    // We also ensure the base64 is cleaned of any "data:image/..." headers.
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: cleanBase64(base64Data),
          mimeType: mimeType,
        },
      },
    ]);

    const response = await result.response;
    const text = response.text();

    // Since we set responseMimeType to application/json, 
    // the model should return raw JSON without markdown backticks.
    return JSON.parse(text);

  } catch (error: any) {
    console.error('IMAGE SCAN ERROR:', error.message);
    // If it's still a 400 error, log the full detail for debugging
    if (error.message.includes('400')) {
      console.error('Check if base64Data is valid and API key has access to 1.5-flash');
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
    
    // No need to replace backticks if using responseMimeType: 'application/json'
    return JSON.parse(response.text());
  } catch (error: any) {
    console.error('TEXT SCAN ERROR:', error.message);
    return null;
  }
}