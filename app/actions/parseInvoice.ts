'use server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function parseInvoiceImage(base64Data: string, mimeType: string) {
  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;

  if (!apiKey) {
    console.error('API Key missing');
    return null;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);

    // FIX: Reverted to a valid model name. 1.5-flash is stable and fast.
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json' },
    });

    const prompt = `
      Extract line items from this pharmacy invoice. 
      Return ONLY a JSON array of objects with keys: 
      "item_name" (string), "qty" (number), "invoice_price" (number).
      Handle pharmaceutical shorthand (e.g., 'Amox' -> 'Amoxicillin').
    `;

    const result = await model.generateContent([
      { inlineData: { data: base64Data, mimeType: mimeType } },
      { text: prompt },
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
  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;

  if (!apiKey) {
    console.error('API Key missing');
    return null;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);

    // FIX: Using a valid model name
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json' },
    });

    const prompt = `
      Extract pharmacy items from the following text. 
      Return ONLY a JSON array of objects with keys: 
      "item_name" (string), "qty" (number)
      Handle pharmaceutical shorthand (e.g., 'Amox' -> 'Amoxicillin').
      Return ONLY a JSON array of objects with keys 'item_name' and 'qty'.
      If quantity is not mentioned, use 1.
      
      Text: ${pastedText}
    `;

    // FIX: Removed the incorrect inlineData block that was causing the crash
    const result = await model.generateContent(prompt);

    const response = await result.response;
    const text = response.text();
    const data = JSON.parse(text);

    // Ensure we return an array even if Gemini wraps it in an object
    return Array.isArray(data) ? data : data.items || data.data || [];
  } catch (error: any) {
    console.error('TEXT SCAN ERROR:', error.message);
    return null;
  }
}
