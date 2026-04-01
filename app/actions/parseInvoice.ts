'use server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const getApiKey = () => process.env.GEMINI_API_KEY;

/**
 * THE FIX: .pop() ensures we get the LAST element (the data)
 * and specifically returns it as a STRING, not an array.
 */
const cleanBase64 = (base64String: string): string => {
  if (typeof base64String !== 'string') return '';
  return base64String.split(',').pop() || '';
};

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
        temperature: 0.1,
      },
    });

    const sanitizedData = cleanBase64(base64Data);

    // We use the most explicit "Part" structure possible here
    const result = await model.generateContent([
      {
        text: 'Extract pharmacy invoice items: item_name, qty, invoice_price. Return ONLY JSON.',
      },
      {
        inlineData: {
          data: sanitizedData, // This is now a String.
          mimeType: mimeType,
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

    const prompt = `Extract pharmacy items from this text. Return ONLY a JSON array of objects with keys: "item_name" and "qty". Text: ${pastedText}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;

    return JSON.parse(response.text());
  } catch (error: any) {
    console.error('TEXT SCAN ERROR:', error.message);
    return null;
  }
}
