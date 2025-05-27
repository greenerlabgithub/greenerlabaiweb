// server.js
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { BlobServiceClient } from '@azure/storage-blob';
import vision from '@google-cloud/vision';
import { VertexAI, HarmCategory, HarmBlockThreshold } from '@google-cloud/vertexai';
import axios from 'axios';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// 미들웨어
app.use(cors());
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));

// Azure Blob 초기화
const blobSvc = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
const containerClient = blobSvc.getContainerClient(process.env.AZURE_STORAGE_CONTAINER);

// GCP Vision & Vertex AI 초기화
const visionClient = new vision.ImageAnnotatorClient();
const vertexAI = new VertexAI({
  project: process.env.GOOGLE_CLOUD_PROJECT,
  location: process.env.VERTEX_LOCATION,
});
const genModel = vertexAI.getGenerativeModel({
  model: 'gemini-1.0-pro-vision',
  safetySettings: [
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_HIGH }
  ],
  generationConfig: { maxOutputTokens: 512 }
});

// Custom Search 설정
const CS_API_KEY = process.env.CUSTOM_SEARCH_API_KEY;
const CS_CX      = process.env.CUSTOM_SEARCH_CX;

// Azure Blob 업로드 헬퍼
async function uploadToAzure(buffer, ext) {
  const blobName = `upload/${Date.now()}_${uuidv4()}.${ext}`;
  const block = containerClient.getBlockBlobClient(blobName);
  await block.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: `image/${ext}` }
  });
  return block.url;
}

// Vision API → 병해충 후보 추출
async function detectCandidates(imageBuffer) {
  const [webRes] = await visionClient.webDetection({ image: { content: imageBuffer } });
  const [labelRes] = await visionClient.labelDetection({ image: { content: imageBuffer } });

  const candidates = (webRes.webDetection.webEntities || [])
    .map(e => ({ description: e.description, score: e.score || 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return candidates;
}

// Custom Search로 텍스트 수집
async function customSearch(query) {
  const url = 'https://www.googleapis.com/customsearch/v1';
  const res = await axios.get(url, {
    params: { key: CS_API_KEY, cx: CS_CX, q: query }
  });
  return (res.data.items || []).map(i => i.snippet).join(' ');
}

// Gemini 요약 헬퍼
async function extractWithGemini(text, prompt) {
  const contents = [{
    role: 'user',
    parts: [{ text: `${prompt}\n\n${text}` }]
  }];
  const resp = await genModel.generateContent({ contents });
  return resp.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// 메인 엔드포인트
app.post('/api/analyze', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 필수' });

    // 1) Base64 → Buffer & Azure Blob 업로드
    const buffer = Buffer.from(imageBase64, 'base64');
    const ext = imageBase64.startsWith('iVBOR') ? 'png' : 'jpg';
    const imageUrl = await uploadToAzure(buffer, ext);

    // 2) Vision → 후보 리스트
    const candidates = await detectCandidates(buffer);
    const label = candidates[0]?.description || null;
    if (!label) {
      return res.json({ candidates, label: null, cause: '', remedy: '', imageUrl });
    }

    // 3) Custom Search → 원인·방제 텍스트
    const causeText  = await customSearch(`${label} 피해 원인`);
    const remedyText = await customSearch(`${label} 방제 방법`);

    // 4) Gemini → 요약
    const cause  = await extractWithGemini(causeText,  `아래 내용을 보고 "${label}"의 피해 원인을 요약해 주세요:`);
    const remedy = await extractWithGemini(remedyText, `아래 내용을 보고 "${label}"의 방제 방법을 요약해 주세요:`);

    // 5) 응답
    res.json({ candidates, label, cause, remedy, imageUrl });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`✅ API listening on port ${PORT}`));
