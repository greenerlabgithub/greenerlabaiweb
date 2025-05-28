// server.js
import express                   from 'express';
import cors                      from 'cors';
import bodyParser                from 'body-parser';
import { BlobServiceClient }     from '@azure/storage-blob';
import vision                    from '@google-cloud/vision';
import VertexAIPkg               from '@google-cloud/vertexai';
import dotenv                    from 'dotenv';
import { v4 as uuidv4 }          from 'uuid';

dotenv.config();
const app  = express();
const PORT = process.env.PORT || 4000;

// Vertex AI SDK default import 후 구조분해
const { VertexAI, HarmCategory, HarmBlockThreshold } = VertexAIPkg;

// Azure Blob 초기화
const blobSvc         = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
const containerClient = blobSvc.getContainerClient(process.env.AZURE_STORAGE_CONTAINER);

// GCP Vision(사용하지 않으시면 지워도 됩니다) & Vertex AI 초기화
const visionClient = new vision.ImageAnnotatorClient();
const vertexAI     = new VertexAI({
  project:  process.env.GOOGLE_CLOUD_PROJECT,
  location: process.env.VERTEX_LOCATION,
});
const genModel = vertexAI.getGenerativeModel({
  publisher: 'google',
  model:     'gemini-2.0-flash-001',   // 또는 'gemini-2.0-flash-001' (텍스트+이미지)
  safetySettings: [
    {
      category:  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      threshold: HarmBlockThreshold.BLOCK_HIGH
    }
  ],
  generationConfig: { maxOutputTokens: 1024 }
});

// 미들웨어
app.use(cors());
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));

// 이미지를 Azure Blob Storage에 업로드
async function uploadToAzure(buffer, ext) {
  const blobName = `upload/${Date.now()}_${uuidv4()}.${ext}`;
  const block    = containerClient.getBlockBlobClient(blobName);
  await block.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: `image/${ext}` }
  });
  return block.url;
}

// 이미지 데이터만 가지고 Gemini Pro Vision 호출 → JSON 결과 파싱
async function analyzeImageWithGemini(buffer) {
  // inline_data 파트: base64 이미지 + mimeType
  const b64       = buffer.toString('base64');
  const imagePart = { inline_data: { data: b64, mimeType: 'image/jpeg' } };

  // 단순 텍스트 프롬프트 (의도 전달)
  const textPart  = {
    text: `
위 이미지는 수목의 병해충 또는 증상을 촬영한 것입니다.
이미지 자체를 분석해서, JSON으로 다음 세 필드를 채워주세요:
{
  "pest": "병해충 이름 또는 증상",
  "cause": "피해 원인",
  "remedy": "방제 방법"
}`
  };

  const contents = [{ role: 'user', parts: [ textPart, imagePart ] }];

  // Google Search 도구 허용 (모델이 필요 시 웹 검색)
  const tools  = [{ googleSearch: {} }];
  const config = { tools, responseMimeType: 'application/json' };

  // 모델 호출
  const result = await genModel.generateContent({ contents, config });
  const raw    = result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  console.log('Raw Gemini response:', raw);

  // JSON 블록만 추출
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Gemini가 JSON을 반환하지 않았습니다.');
  return JSON.parse(match[0]);
}

// 메인 엔드포인트: 이미지(Base64) 받으면 업로드 + 분석 → 응답
app.post('/api/analyze', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64 필수입니다.' });
    }

    // 1) Base64 → Buffer
    const buffer = Buffer.from(imageBase64, 'base64');
    const ext    = imageBase64.startsWith('iVBOR') ? 'png' : 'jpg';

    // 2) Azure Blob에 저장 (선택 사항)
    const imageUrl = await uploadToAzure(buffer, ext);

    // 3) Gemini Pro Vision으로 분석 (이미지만 사용)
    const { pest, cause, remedy } = await analyzeImageWithGemini(buffer);

    // 4) 클라이언트 응답
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
