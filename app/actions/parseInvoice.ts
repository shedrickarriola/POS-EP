'use server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function parseInvoiceImage(base64Data: string, mimeType: string) {
  // 1. Force the use of the Vercel key
  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;

  if (!apiKey) {
    console.error('SERVER ERROR: NEXT_PUBLIC_GEMINI_API_KEY is undefined');
    return null;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1, // Makes the AI more consistent
      },
    });

    const prompt = `
      Extract items from this invoice. 
      Return ONLY a JSON array of objects with keys: 
      "item_name" (string), "qty" (number), "invoice_price" (number).
      Do not include any text other than the JSON.
    `;

    const result = await model.generateContent([
      { inlineData: { data: base64Data, mimeType: mimeType } },
      { text: prompt },
    ]);

    const response = await result.response;
    const text = response.text();

    // 2. CLEANING STEP: Remove markdown blocks that break parsing
    const cleanJson = text.replace(/```json|```/g, '').trim();

    console.log('AI Raw Output:', cleanJson); // This shows in Vercel Logs

    return JSON.parse(cleanJson);
  } catch (error: any) {
    // 3. LOGGING: This tells us exactly why it failed (e.g. 403 Forbidden, 429 Quota)
    console.error('AI SERVER ERROR:', error.message);
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
