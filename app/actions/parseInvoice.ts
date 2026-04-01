'use server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Helper to get API Key safely
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
      model: 'gemini-1.5-flash', // Correct stable model
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

    const result = await model.generateContent([
      { inlineData: { data: base64Data, mimeType: mimeType } },
      { text: prompt },
    ]);

    const response = await result.response;
    const text = response.text();
    
    // Robust cleaning: removes markdown and any leading/trailing whitespace
    const cleanJson = text.replace(/```json|```/g, '').trim();
    console.log('AI Image Scan Raw Output:', cleanJson);

    return JSON.parse(cleanJson);
  } catch (error: any) {
    console.error('IMAGE SCAN ERROR:', error.message);
    return null;
  }
}

export async function parseInvoiceText(pastedText: string) {
  const apiKey = getApiKey();

  if (!apiKey) {
    console.error('SERVER ERROR: API Key missing');
    return null;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);

    // FIX: Changed from 2.5-flash to 1.5-flash
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash', 
      generationConfig: { 
        responseMimeType: 'application/json',
        temperature: 0.1
      },
    });

    const prompt = `
      Extract pharmacy items from the following text. 
      Return ONLY a JSON array of objects with keys: "item_name" and "qty".
      Handle pharmaceutical shorthand (e.g., 'Amox' -> 'Amoxicillin').
      If quantity is not mentioned, use 1.
      
      Text: ${pastedText}
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    const cleanJson = text.replace(/```json|```/g, '').trim();
    console.log('AI Text Scan Raw Output:', cleanJson);
    
    const data = JSON.parse(cleanJson);
    return Array.isArray(data) ? data : data.items || data.data || [];

  } catch (error: any) {
    console.error('TEXT SCAN ERROR:', error.message);
    return null;
  }
}