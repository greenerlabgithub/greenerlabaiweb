// server.js
import express               from 'express';
import cors                  from 'cors';
import bodyParser            from 'body-parser';
import { BlobServiceClient } from '@azure/storage-blob';
import vision                from '@google-cloud/vision';
import VertexAIPkg           from '@google-cloud/vertexai';
import axios                 from 'axios';
import dotenv                from 'dotenv';
import { v4 as uuidv4 }      from 'uuid';

dotenv.config();
const app  = express();
const PORT = process.env.PORT || 4000;

// CommonJS default import 후 구조분해
const {
  VertexAI,
  HarmCategory,
  HarmBlockThreshold
} = VertexAIPkg;

// Azure Blob 초기화
const blobSvc         = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
const containerClient = blobSvc.getContainerClient(process.env.AZURE_STORAGE_CONTAINER);

// GCP Vision & Vertex AI 초기화
const visionClient = new vision.ImageAnnotatorClient();
const vertexAI     = new VertexAI({
  project:  process.env.GOOGLE_CLOUD_PROJECT,
  location: process.env.VERTEX_LOCATION,
});
const genModel = vertexAI.getGenerativeModel({
  publisher: 'google',
  model:     'gemini-pro-vision',
  safetySettings: [
    {
      category:  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      threshold: HarmBlockThreshold.BLOCK_HIGH
    }
  ],
  generationConfig: { maxOutputTokens: 1024 }
});

// 이미지 Azure Blob 업로드 헬퍼
async function uploadToAzure(buffer, ext) {
  const blobName = `upload/${Date.now()}_${uuidv4()}.${ext}`;
  const block    = containerClient.getBlockBlobClient(blobName);
  await block.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: `image/${ext}` }
  });
  return block.url;
}

// 이미지 기반 분석 헬퍼
async function analyzeImageWithGemini(buffer) {
  // Base64 인코딩 (inline_data 파트 사용) :contentReference[oaicite:0]{index=0}
  const b64       = buffer.toString('base64');
  const textPart  = { text: `
이 이미지는 수목의 병해충 또는 증상을 촬영한 것입니다.
아래 이미지에 나타난 병해충/병증 이름과 피해 원인, 방제 방법을
JSON 형식으로 정확히 알려 주세요:
{"pest": "", "cause": "", "remedy": ""}
  `.trim() };
  const imagePart = { inline_data: { data: b64, mimeType: 'image/jpeg' } };

  const contents = [{ role: 'user', parts: [ textPart, imagePart ] }];
  const tools    = [{ googleSearch: {} }];
  const config   = { tools, responseMimeType: 'application/json' };

  const result = await genModel.generateContent({ contents, ...config });
  const raw    = result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  console.log('Raw Gemini response:', raw);

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Gemini가 JSON을 반환하지 않았습니다.');
  return JSON.parse(match[0]);
}

// 메인 엔드포인트
app.post('/api/analyze', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64 필수입니다.' });
    }

    // 1) Base64 → Buffer & Blob 업로드
    const buffer   = Buffer.from(imageBase64, 'base64');
    const ext      = imageBase64.startsWith('iVBOR') ? 'png' : 'jpg';
    const imageUrl = await uploadToAzure(buffer, ext);

    // 2) Gemini Pro Vision 분석
    const { pest, cause, remedy } = await analyzeImageWithGemini(buffer);

    // 3) 응답
    return res.json({ imageUrl, pest, cause, remedy });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`✅ API listening on port ${PORT}`);
});
