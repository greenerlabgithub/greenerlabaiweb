// server.js
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { BlobServiceClient } from '@azure/storage-blob';
import { SearchClient, AzureKeyCredential } from '@azure/search-documents';
import { OpenAI } from 'openai';
import decodeUriComponent from 'decode-uri-component';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
app.use(cors());
app.use(bodyParser.json({ limit:'50mb' }));

// Azure Blob
const blobSvc         = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
const containerClient = blobSvc.getContainerClient(process.env.AZURE_STORAGE_CONTAINER);

// Azure AI Search
const searchClient = new SearchClient(
  process.env.AZURE_SEARCH_ENDPOINT,
  process.env.AZURE_SEARCH_INDEX,
  new AzureKeyCredential(process.env.AZURE_SEARCH_KEY)
);

// Azure OpenAI
const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_KEY,
  endpoint: process.env.AZURE_OPENAI_ENDPOINT,
  azure: { deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT }
});

// 1) 이미지 업로드
async function uploadToAzure(buffer, ext='png') {
  const blobName = `upload/${Date.now()}.${ext}`;
  const blob     = containerClient.getBlockBlobClient(blobName);
  await blob.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: `image/${ext}` }
  });
  return blob.url;
}

// 2) 벡터 검색 → Top 3
async function findTop3(blobUrl) {
  // searchDocuments()는 Promise를 반환하므로 await를 붙입니다.
  const response = await searchClient.searchDocuments({
    searchText: "*",
    vector: {
      fields:     'content_embedding',
      vectorizer: process.env.IMAGE_VECTORIZER,
      imageUrl:   blobUrl,
      k:          3
    },
    select: ['image_document_id'],  // 🚩 여기를 image_document_id로 변경
    top: 3
  });

  // .results는 배열이므로 일반 for/of 나 map 으로 순회 가능합니다.
  return response.results.map(r => {
    const raw = r.document.image_document_id || '';
    const decoded = decodeUriComponent(raw);
    return {
      name:  decoded,
      score: r.score
    };
  });
}

// 3) o4-mini에 정보 요청
async function fetchEntityInfo(name) {
  const prompt = `
이름: ${name}
이 곤충 혹은 식물, 수목에 대한 정보를 제공해주세요.
병을 옮기는 병해충이거나 병증을 보이는 식물, 수목의 경우 예시로 어떤 현상을 일으키는지 어떤 방제방법이 있는지 제공해줍니다.

대답은 JSON형태의 예시로 통일합니다.
{
  "이름": "${name}",
  "정보": "...",
  "방제방법": ["…","…","…"]
}
`;
  const resp = await openai.chat.completions.create({
    messages: [{ role:'user', content: prompt }],
    temperature: 0.2,
    max_tokens: 512
  });
  // JSON 블록만 뽑아서 파싱
  const text = resp.choices[0].message.content;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('LLM이 JSON을 반환하지 않았습니다.');
  return JSON.parse(jsonMatch[0]);
}

app.post('/api/analyze', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ error:'imageBase64 필요' });

    // A) 이미지 업로드
    const buffer = Buffer.from(imageBase64, 'base64');
    const ext    = imageBase64.startsWith('iVBOR') ? 'png' : 'jpg';
    const blobUrl = await uploadToAzure(buffer, ext);

    // B) Top-3 벡터 검색
    const top3 = await findTop3(blobUrl);

    // C) 각 후보에 대해 o4-mini 호출
    const results = [];
    for (const candidate of top3) {
      const info = await fetchEntityInfo(candidate.name);
      results.push(info);
    }

    // D) 최종 응답
    return res.json({
      imageUrl: blobUrl,
      type:     'vector+llm',
      results   // [ {이름, 정보, 방제방법}, … x3 ]
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT||4000;
app.listen(PORT, ()=> console.log(`API listening on ${PORT}`));
