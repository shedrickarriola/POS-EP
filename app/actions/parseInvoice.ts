'use server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const getApiKey = () => process.env.NEXT_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY;

export async function parseInvoiceImage(base64Data: string, mimeType: string) {
  const apiKey = getApiKey();

  if (!apiKey) {
    console.error('SERVER ERROR: API Key missing');
    return null;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: { 
        responseMimeType: 'application/json',
        temperature: 0.1 
      },
    });

    const prompt = `
      Extract items from this pharmacy invoice. 
      Return ONLY a JSON array of objects with keys: 
      "item_name" (string), "qty" (number), "invoice_price" (number).
      Handle pharmaceutical shorthand (e.g., 'Amox' -> 'Amoxicillin').
    `;

    // FIX: The array should contain ONE object with a 'parts' array, 
    // OR just pass the parts directly as an array.
    const result = await model.generateContent([
      {
        inlineData: {
          data: base64Data,
          mimeType: mimeType
        }
      },
      {
        text: prompt
      }
    ]);

    const response = await result.response;
    const text = response.text();
    
    const cleanJson = text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleanJson);

  } catch (error: any) {
    // This will now show the specific reason if it fails again
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
    const text = response.text();
    
    const cleanJson = text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleanJson);
  } catch (error: any) {
    console.error('TEXT SCAN ERROR:', error.message);
    return null;
  }
}