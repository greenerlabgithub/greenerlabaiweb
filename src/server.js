// server.js  (or index.js)
import express from 'express';
import bodyParser from 'body-parser';
import { BlobServiceClient } from '@azure/storage-blob';
import cors from 'cors';
import { generate } from './gemini';  // 기존 Gemini 로직

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' })); // 이미지용으로 넉넉히

// Azure Blob 준비
const blobSvc = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
const containerClient = blobSvc.getContainerClient('images');
await containerClient.createIfNotExists();

// base64 → Blob 업로드
async function uploadImage(base64, filename) {
  const buffer = Buffer.from(base64, 'base64');
  const block = containerClient.getBlockBlobClient(filename);
  await block.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: 'image/jpeg' }
  });
  return block.url;
}

// /api/analyze 라우터
app.post('/api/analyze', async (req, res) => {
  try {
    const { additionalInfo, ...images } = req.body;
    const keys = Object.keys(images).filter(k => k.startsWith('imageData'));
    // 1) Blob 에 올리고 URL 모으기
    const imageUrls = await Promise.all(keys.map((k, i) => {
      const name = `img_${Date.now()}_${i}.jpg`;
      return uploadImage(images[k], name);
    }));
    // 2) Gemini API 호출 (base64 배열)
    const base64s = keys.map(k => images[k]);
    const resultText = await generate(
      base64s.map(b64 => Buffer.from(b64, 'base64')), 
      additionalInfo
    );
    // 3) 응답
    res.json({ result: resultText, imageUrls });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(4000, () => console.log('API listening on 4000'));

