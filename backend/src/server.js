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

// GCP Vision 클라이언트 (필요 없으면 지워도 됩니다)
const visionClient = new vision.ImageAnnotatorClient();

// Vertex AI 클라이언트 및 Pro-Vision 모델
const vertexAI = new VertexAI({
  project:  process.env.GOOGLE_CLOUD_PROJECT,
  location: process.env.VERTEX_LOCATION,
});
const genModel = vertexAI.getGenerativeModel({
  publisher: 'google',
  model:     'gemini-pro-vision',   // 이미지 입력 지원 모델
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

// 이미지 Azure Blob 업로드 헬퍼
async function uploadToAzure(buffer, ext) {
  const blobName = `upload/${Date.now()}_${uuidv4()}.${ext}`;
  const block    = containerClient.getBlockBlobClient(blobName);
  await block.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: `image/${ext}` }
  });
  return block.url;
}

// 이미지 원본만으로 Gemini Pro Vision 호출 → JSON 결과 파싱
async function analyzeImageWithGemini(buffer) {
  // inline_data 파트에 Base64+mimeType 전달
  const b64       = buffer.toString('base64');
  const imagePart = { inline_data: { data: b64, mimeType: 'image/jpeg' } };

  // 모델에게 “이미지를 분석해서 pest, cause, remedy를 JSON으로”
  const textPart  = {
    text: `
다음 이미지는 수목의 병해충 또는 증상을 촬영한 것입니다.
이미지 자체만 보고, 아래 JSON 형식으로 세 가지를 정확히 출력해 주세요:
{
  "pest": "병해충 이름 또는 증상",
  "cause": "피해 원인",
  "remedy": "방제 방법"
}`
  };

  const contents = [{ role: 'user', parts: [ textPart, imagePart ] }];
  const tools    = [{ googleSearch: {} }];      // 필요 시 웹 검색 허용
  const config   = { tools, responseMimeType: 'application/json' };

  const result = await genModel.generateContent({ contents, config });
  const raw    = result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  console.log('Raw Gemini response:', raw);

  // JSON 블록만 꺼내 파싱
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Gemini가 JSON을 반환하지 않았습니다.');
  return JSON.parse(match[0]);
}

// 메인 엔드포인트
app.post('/api/analyze', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64(이미지 Base64) 필수입니다.' });
    }

    // Base64 → Buffer
    const buffer = Buffer.from(imageBase64, 'base64');
    const ext    = imageBase64.startsWith('iVBOR') ? 'png' : 'jpg';

    // 1) Azure Blob에 저장 (선택)
    const imageUrl = await uploadToAzure(buffer, ext);

    // 2) Gemini Pro Vision 이미지 분석
    const { pest, cause, remedy } = await analyzeImageWithGemini(buffer);

    // 3) 최종 응답
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
