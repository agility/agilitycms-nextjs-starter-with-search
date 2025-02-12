export const config = {
	runtime: "edge",
  };
  
import FlexSearch from "flexsearch";
import agility from "@agility/content-fetch";
import { NextResponse } from "next/server";
import { del, list, put } from "@vercel/blob";

// Create the search index
let index: FlexSearch.Document<
  { id: number; title: string; content: string; url: string },
  string[]
> | null = null;
let pages: { id: number; title: string; content: string; url: string }[] = [];
let isIndexLoaded = false;

const isDevMode = () => process.env.NODE_ENV === "development";

async function deleteAllBlobs(prefix: string) {
  let cursor;
  do {
    const listResult: any = await list({
      token: isDevMode()
        ? process.env.DEV_BLOB_READ_WRITE_TOKEN
        : process.env.BLOB_READ_WRITE_TOKEN,
      cursor,
      limit: 1000,
      prefix,
    });

    if (listResult.blobs.length > 0) {
      await del(
        listResult.blobs.map((blob: any) => blob.url),
        {
          token: isDevMode()
            ? process.env.DEV_BLOB_READ_WRITE_TOKEN
            : process.env.BLOB_READ_WRITE_TOKEN,
        }
      );
    }

    cursor = listResult.cursor;
  } while (cursor);
}

async function saveSearchIndex() {
  if (index) {
    const prefix = "search-index";
    await deleteAllBlobs(prefix);

    await index.export(async (key, data) => {
      
      try {
        await put(`${prefix}/${key}.json`, JSON.stringify(data ?? null), {
          access: "public",
          contentType: "application/json",
          token: isDevMode()
            ? process.env.DEV_BLOB_READ_WRITE_TOKEN
            : process.env.BLOB_READ_WRITE_TOKEN,
        });
      } catch (error) {
        console.log("error", error);
      }
    });
  }
}

async function loadSearchIndex() {
	if (isIndexLoaded && index) return;
  
	const prefix = "search-index";
	const listData = await list({
	  prefix,
	  token: isDevMode()
		? process.env.DEV_BLOB_READ_WRITE_TOKEN
		: process.env.BLOB_READ_WRITE_TOKEN,
	});
  
	if (listData.blobs.length === 0) {
	  await loadSitemapData(); // Only rebuild if completely missing
	  return;
	}
  
	index = new FlexSearch.Document({
	  tokenize: "full",
	  document: {
		id: "id",
		index: ["title", "content", "url"],
		store: ["title", "content", "url"],
	  },
	  context: {
		resolution: 9,
		depth: 2,
		bidirectional: true,
	  },
	});
  
	// Use `Promise.all()` to fetch blobs in parallel
	await Promise.all(
	  listData.blobs.map(async (blob) => {
		const key = blob.pathname.replace("search-index/", "").replace(".json", "");
		const blobData = await fetch(blob.url);
		const response = await blobData.json();
		if (response) {
		  index?.import(key, response);
		}
	  })
	);

	isIndexLoaded = true;
  }

  async function loadSitemapData() {
	const isPreview = process.env.NODE_ENV === "development";
	const apiKey = isPreview
	  ? process.env.AGILITY_API_PREVIEW_KEY
	  : process.env.AGILITY_API_FETCH_KEY;
  
	const api = agility.getApi({
	  guid: process.env.AGILITY_GUID,
	  apiKey,
	  isPreview,
	});
  
	const sitemap = await api.getSitemapFlat({
	  channelName: process.env.AGILITY_SITEMAP || "website",
	  languageCode: process.env.AGILITY_LOCALES,
	});
  
	const pagePromises = Object.keys(sitemap).map(async (path) => {
	  try {
		const data = await api.getPageByPath({
		  pagePath: path,
		  languageCode: process.env.AGILITY_LOCALES,
		  channelName: process.env.AGILITY_SITEMAP || "website",
		  contentLinkDepth: 4,
		});
  
		const { sitemapNode } = data;
  
		const pageContent = Object.keys(data.page.zones)
		  .flatMap((zoneKey) => {
			return data.page.zones[zoneKey].map((module: any) => {
			  if (module.module === "PostDetails") return data.contentItem.fields.content;
			  if (module.module === "RichTextArea") return module.item.fields.textblob;
			  if (module.module === "TextBlockWithImage") return module.item.fields.content;
			  return "";
			});
		  })
		  .join(" ")
		  .replace(/<\/?[^>]+(>|$)/g, "") // Strip HTML tags
		  .replace(/[\r\n]+/g, " ");
  
		return {
		  id: sitemapNode.path,
		  title: sitemapNode.title,
		  content: pageContent,
		  url: sitemapNode.path,
		};
	  } catch (error) {
		console.error(`Failed to fetch page: ${path}`, error);
		return null; // Prevent crash on error
	  }
	});
  
	const results = await Promise.allSettled(pagePromises);
	pages = results
	  .filter((r) => r.status === "fulfilled" && r.value)
	  .map((r: any) => r.value);
  
	pages.forEach((page) => index?.add(page));
  
	await saveSearchIndex();
  }

// Load data when the API server starts
// loadSitemapData().catch(console.error);

// we don't want to automatically load the sitemapdata, only if no index is present

// automatically load the search index on the first request
// loadSearchIndex().catch(console.error);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("query");

  const start = Date.now();
  console.log(`[DEBUG] Start request at ${new Date().toISOString()}`);


//   if (!index) {
// 	console.log(`[DEBUG] Index not loaded, loading now...`);
//     await loadSearchIndex();
//   }


  if (!query) {
    return NextResponse.json(
      { error: "Query parameter is required" },
      { status: 400 }
    );
  }

  if (!isIndexLoaded) {
	console.log(`[DEBUG] Index not loaded, loading now...`);
    await loadSearchIndex();
  }

  const mid = Date.now();
  console.log(`[DEBUG] Search index loaded in ${mid - start}ms`);


  const search = index?.search({ query, enrich: true });

  const results =
    search?.flatMap((result: any) => {
      return result.result.map((element: any) => {
        return element.doc;
      });
    }) || [];

  // the data can match against multiple indexes, so we need to remove duplicates
  const uniqueResults = Array.from(
    new Map(results.map((item) => [item?.url, item])).values()
  ) || [];

  const end = Date.now();
  console.log(`[DEBUG] Search completed in ${end - mid}ms`);
  console.log(`[DEBUG] Total request time: ${end - start}ms`);

  return NextResponse.json(uniqueResults);
}

export async function POST() {
  // this is to be used for the webhook to trigger a rebuild of the search index
  try {
    index = null; // Reset index
	await loadSitemapData(); // Rebuild index
    return NextResponse.json({ message: "Index updated successfully" });
  } catch (error) {
    console.error("Error updating index:", error);
    return NextResponse.json(
      { error: "Failed to update index" },
      { status: 500 }
    );
  }
}
