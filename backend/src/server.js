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
const vertexAI    = new VertexAI({
  project:  process.env.GOOGLE_CLOUD_PROJECT,
  location: process.env.VERTEX_LOCATION,
});
const genModel = vertexAI.getGenerativeModel({
  publisher: 'google',              // 퍼블리셔 명시
  model:     'gemini-2.0-flash-001',
  safetySettings: [
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      threshold: HarmBlockThreshold.BLOCK_HIGH }
  ],
  generationConfig: { maxOutputTokens: 1024 }
});

// Custom Search 설정
const CS_API_KEY = process.env.CUSTOM_SEARCH_API_KEY;
const CS_CX      = process.env.CUSTOM_SEARCH_CX;

// 업로드 헬퍼
async function uploadToAzure(buffer, ext) {
  const blobName = `upload/${Date.now()}_${uuidv4()}.${ext}`;
  const block    = containerClient.getBlockBlobClient(blobName);
  await block.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: `image/${ext}` }
  });
  return block.url;
}

// Vision 후보 추출
async function detectCandidates(buffer) {
  const [webRes]   = await visionClient.webDetection({ image: { content: buffer } });
  const candidates = (webRes.webDetection.webEntities || [])
    .map(e => ({ description: e.description, score: e.score || 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  return candidates;
}

// Custom Search
async function customSearch(query) {
  const url = 'https://www.googleapis.com/customsearch/v1';
  const res = await axios.get(url, {
    params: { key: CS_API_KEY, cx: CS_CX, q: query }
  });
  return (res.data.items || []).map(i => i.snippet).join(' ');
}

// Gemini → JSON 파싱 헬퍼
async function extractJsonWithGemini(rawText, label, key) {
  // JSON 모드 + 엄격 지시
  const prompt = `
"${label}"의 ${ key === 'cause' ? '피해 원인' : '방제 방법' }을
아래 JSON 형식으로 **정확히** 출력해 주세요 (절대로 다른 설명 없이):
{
  "${key}": "여기에 텍스트"
}

내용:
${rawText}
  `.trim();

  const contents = [{ role: 'user', parts: [{ text: prompt }] }];
  const config = {
    responseMimeType: 'application/json',
    generationConfig: { maxOutputTokens: 512 }
  };

  const resp = await genModel.generateContent({ contents, config });
  // 전체 응답 로그 (디버깅용)
  console.log(`Raw Gemini JSON response for key '${key}':`);
  console.log(JSON.stringify(resp, null, 2));

  // resp.candidates[0].content.parts[0].text 에 JSON 혹은 코드 블록이 들어있음
  const raw = resp.candidates?.[0]?.content?.parts?.[0]?.text || '';
  // 코드블록(```json ...```) 안에서도 JSON만 꺼내기
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn(`JSON 파싱 실패. Raw response for ${key}:`, raw);
    return '';
  }

  try {
    const obj = JSON.parse(jsonMatch[0]);
    return obj[key] || '';
  } catch (e) {
    console.warn(`JSON 파싱 에러 (${key}):`, e);
    console.warn('Problematic JSON:', jsonMatch[0]);
    return '';
  }
}

// 메인 엔드포인트
app.post('/api/analyze', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 필수' });

    // 1) 저장
    const buffer   = Buffer.from(imageBase64, 'base64');
    const ext      = imageBase64.startsWith('iVBOR') ? 'png' : 'jpg';
    const imageUrl = await uploadToAzure(buffer, ext);

    // 2) 후보
    const candidates = await detectCandidates(buffer);
    const label      = candidates[0]?.description || null;
    if (!label) {
      return res.json({ candidates, label: null, cause: '', remedy: '', imageUrl });
    }

    // 3) 검색
    const causeText  = await customSearch(`${label} 피해 원인`);
    const remedyText = await customSearch(`${label} 방제 방법`);

    // 4) Gemini → JSON 파싱
    const cause  = await extractJsonWithGemini(causeText,  label, 'cause');
    const remedy = await extractJsonWithGemini(remedyText, label, 'remedy');

    // 5) 응답
    res.json({ candidates, label, cause, remedy, imageUrl });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`✅ API listening on port ${PORT}`));
