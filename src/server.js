// server.js
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { BlobServiceClient, BlockBlobUploadStreamOptions } from '@azure/storage-blob';
import { Client, types } from 'google-genai';
import dotenv from 'dotenv';
import { Buffer } from 'buffer';
import { Readable } from 'stream';
import { Image } from 'canvas';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '20mb' }));

// Azure Blob 초기화
const blobSvc = BlobServiceClient.fromConnectionString(
  process.env.AZURE_STORAGE_CONNECTION_STRING
);
const containerClient = blobSvc.getContainerClient('images');
await containerClient.createIfNotExists();

// 이미지 바이트 → genai.Part 생성
async function partFromBytes(buffer) {
  // `canvas` 패키지 설치 시 사용. 없으면 JPEG 고정 가능
  let mime = 'image/jpeg';
  try {
    const img = new Image();
    img.src = buffer;
    mime = img.type || mime;
  } catch {}
  return types.Part.fromBytes({ data: buffer, mimeType: mime });
}

// Gemini 호출
async function generateWithGemini(buffers, additionalInfo) {
  const client = new Client({ apiKey: process.env.GOOGLE_API_KEY });
  const model = 'gemini-2.0-flash-001';

  // 텍스트 + 이미지 파트 조합
  const parts = [
    types.Part.fromText({
      text:
        '이 이미지는 수목 혹은 식물에 영향을 주는 곤충 혹은 병증입니다. ' +
        additionalInfo,
    }),
    ...(await Promise.all(buffers.map((b) => partFromBytes(b)))),
  ];

  const contents = [{ role: 'user', parts }];
  const config = types.GenerateContentConfig.fromPartial({
    topP: 0.5,
    tools: [types.Tool.fromPartial({ googleSearch: {} })],
    responseMimeType: 'text/plain',
  });

  const res = await client.models.generateContent({
    model,
    contents,
    config,
  });
  return res.text;
}

// API 엔드포인트
app.post('/api/analyze', async (req, res) => {
  try {
    const { additionalInfo, imageData1, imageData2, imageData3 } = req.body;
    const base64s = [imageData1, imageData2, imageData3].filter(Boolean);
    if (base64s.length < 1 || base64s.length > 3) {
      return res
        .status(400)
        .json({ error: 'imageData1~3 중 최소 1개, 최대 3개를 보내주세요.' });
    }

    // 1) Base64 → Buffer
    const buffers = base64s.map((b64) => Buffer.from(b64, 'base64'));

    // 2) Blob 업로드
    const imageUrls = [];
    for (let i = 0; i < buffers.length; i++) {
      const name = `img_${Date.now()}_${i}.jpg`;
      const block = containerClient.getBlockBlobClient(name);
      await block.uploadData(buffers[i], {
        blobHTTPHeaders: { blobContentType: 'image/jpeg' },
      });
      imageUrls.push(block.url);
    }

    // 3) Gemini 분석
    const resultText = await generateWithGemini(buffers, additionalInfo);

    return res.json({ result: resultText, imageUrls });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () =>
  console.log(`🌳 GreenerLabAI API listening on port ${PORT}`)
);
