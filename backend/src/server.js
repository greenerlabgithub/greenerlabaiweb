// server.js
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { BlobServiceClient } from '@azure/storage-blob';
import { SearchClient, AzureKeyCredential } from '@azure/search-documents';
import { AzureOpenAI } from 'openai';
import decodeUriComponent from 'decode-uri-component';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
const  apiKey = process.env.AZURE_OPENAI_KEY;
const  deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
const  apiVersion = process.env.AZURE_OPENAI_API_VERSION;
const options = { endpoint, apiKey, deployment, apiVersion }

// Azure Blob 설정
const blobSvc = BlobServiceClient.fromConnectionString(
  process.env.AZURE_STORAGE_CONNECTION_STRING
);
const containerClient = blobSvc.getContainerClient(
  process.env.AZURE_STORAGE_CONTAINER
);

// Azure Cognitive Search 설정
const searchClient = new SearchClient(
  process.env.AZURE_SEARCH_ENDPOINT,
  process.env.AZURE_SEARCH_INDEX,
  new AzureKeyCredential(process.env.AZURE_SEARCH_KEY)
);

// Azure OpenAI 설정
const openai = new AzureOpenAI(options);

// 1) 이미지 업로드 유틸
async function uploadToAzure(buffer, ext = 'png') {
  const blobName = `upload/${Date.now()}.${ext}`;
  const blockBlob = containerClient.getBlockBlobClient(blobName);
  await blockBlob.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: `image/${ext}` }
  });
  return blockBlob.url;
}

// 2) 벡터 검색 → Top 3
async function findTop3(blobUrl) {
  const response = await searchClient.searchDocuments(
    "*", // 반드시 문자열
    {
      vector: {
        fields: "content_embedding",
        vectorizer: process.env.IMAGE_VECTORIZER,
        imageUrl: blobUrl,
        k: 3
      },
      select: ["image_document_id"],
      top: 3
    }
  );

  return response.results.map(r => {
    const raw = r.document.image_document_id || "";
    const decoded = decodeUriComponent(raw);
    return { name: decoded, score: r.score };
  });
}

// 3) o4-mini(LLM) 호출 유틸
async function fetchEntityInfo(name) {
  const prompt = `
이름: ${name}
이 곤충 혹은 식물, 수목에 대한 정보를 제공해주세요.
병을 옮기는 병해충이거나 병증을 보이는 식물, 수목의 경우 예시로 어떤 현상을 일으키는지 어떤 방제방법이 있는지 제공해줍니다.

대답은 JSON 형태로,
{
  "이름": "${name}",
  "정보": "...",
  "방제방법": ["…","…","…"]
}
와 같이 통일해주세요.
`;
  const resp = await openai.chat.completions.create({
    model: process.env.AZURE_OPENAI_MODEL,
    messages: [{ role: "user", content: prompt }],
    max_completion_tokens:   100000 
  });
  const text = resp.choices[0].message.content;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("LLM이 JSON을 반환하지 않았습니다.");
  return JSON.parse(jsonMatch[0]);
}

// 4) 분석 API 엔드포인트
app.post('/api/analyze', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64가 필요합니다.' });
    }

    // base64 → Buffer, ext 결정
    const buffer = Buffer.from(imageBase64, 'base64');
    const ext = imageBase64.startsWith('iVBOR') ? 'png' : 'jpg';

    // (1) Azure Blob에 업로드
    const blobUrl = await uploadToAzure(buffer, ext);
    // (2) Top-3 벡터 검색
    const top3 = await findTop3(blobUrl);
    // (3) o4-mini 호출 (병렬)
    const results = await Promise.all(
      top3.map(c => fetchEntityInfo(c.name))
    );
    // (4) 최종 응답
    res.json({ imageUrl: blobUrl, type: 'vector+llm', results });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// 서버 시작
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API listening on ${PORT}`));
