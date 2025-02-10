import FlexSearch from "flexsearch";
import agility from '@agility/content-fetch'
import { NextResponse } from "next/server";
import  { del, list, put } from '@vercel/blob';

// Create the search index
let index: FlexSearch.Document<{ id: number; title: string; content:string, url: string }, string[]> | null = null;
let pages: { id: number; title: string; content:string, url: string }[] = [];


const isDevMode = () => process.env.NODE_ENV === 'development';


async function deleteAllBlobs(prefix: string) {
  let cursor;
  do {
    const listResult: any = await list({
      token: isDevMode() ? process.env.DEV_BLOB_READ_WRITE_TOKEN : process.env.BLOB_READ_WRITE_TOKEN,
      cursor,
      limit: 1000,
      prefix,
    });

    if (listResult.blobs.length > 0) {
      await del(listResult.blobs.map((blob: any) => blob.url), {
        token: isDevMode() ? process.env.DEV_BLOB_READ_WRITE_TOKEN : process.env.BLOB_READ_WRITE_TOKEN,
      });
    }

    cursor = listResult.cursor;
  } while (cursor);
}

async function saveSearchIndex() {
  if (index) {
    await index.export(async (data)=>{
		
		console.log('Saving search index to Blob')
		const prefix = 'search-index';
		await deleteAllBlobs(prefix);
		await put(`${prefix}/index.json`, JSON.stringify(data), {
		  access: 'public',
		  contentType: 'application/json',
		  token: isDevMode() ? process.env.DEV_BLOB_READ_WRITE_TOKEN : process.env.BLOB_READ_WRITE_TOKEN,
		});


	});


    
  }
}

async function loadSearchIndex() {

	console.log('Loading search index from Blob')
  const prefix = 'search-index';
  const listData = await list({
    prefix,
    token: isDevMode() ? process.env.DEV_BLOB_READ_WRITE_TOKEN : process.env.BLOB_READ_WRITE_TOKEN,
  });


  console.log('listData', listData);
  if(listData.blobs.length === 0){
	console.log('No search index found in Blob');
	loadSitemapData().catch(console.error);
	// return;
  }

  for (const blob of listData.blobs) {

	console.log('blob', blob);
    const blobData = await fetch(blob.url);
    const response = await blobData.json();
    if (response) {

		console.log('response', response);
    //   index = FlexSearch.create();
    //   index.import(response);
    }
  }
}






async function loadSitemapData() {

	if (index !== null) return; // Prevent reloading on every request

	const isDevelopmentMode = process.env.NODE_ENV === "development"
	const isPreview = isDevelopmentMode

	const apiKey = isPreview ? process.env.AGILITY_API_PREVIEW_KEY : process.env.AGILITY_API_FETCH_KEY

	const api =  agility.getApi({
		guid: process.env.AGILITY_GUID,
		apiKey,
		isPreview
	});

	const sitemap = await api.getSitemapFlat({
		channelName:  process.env.AGILITY_SITEMAP || "website",	
		languageCode: process.env.AGILITY_LOCALES,
	});	
	
	const pagePromises = Object.keys(sitemap).map(async (path) => {
		
		const data = await api.getPageByPath({
			pagePath: path,
			languageCode: process.env.AGILITY_LOCALES,
			channelName: process.env.AGILITY_SITEMAP || 'website',
			contentLinkDepth: 4,
		});

		const { sitemapNode } = data;

		const pageContent = Object.keys(data.page.zones).map((zoneKey) => {
			const zone = data.page.zones[zoneKey];

			return zone.map((module: any) => {

				let response = '';
				if(module.module === 'PostDetails'){
					response = data.contentItem.fields.content
				}

				if(module.module === 'RichTextArea'){
				    response = module.item.fields.textblob
				}

				if(module.module === 'TextBlockWithImage'){
					response = module.item.fields.content
				}

				const strippedContent = response.replace(/<\/?[^>]+(>|$)/g, "").replace(/[\r\n]+/g, " ");
				if(strippedContent !== ''){
					return strippedContent;
				}

			}).join(' '); // Join modules into a single string
		}).join(' '); // Join zones into a single string

		return {
			id: sitemapNode.path,
			title: sitemapNode.title,
			content: pageContent,
			url: sitemapNode.path,
		}
	});

	pages = await Promise.all(pagePromises);
	index = new FlexSearch.Document({
		tokenize: 'full',
		document: {
			id: "id",
			index: ["title", "content", "url"],
			store: ["title","content", "url"],
		},
		context: {
			resolution: 9,
			depth: 2,
			bidirectional: true,
		},
	});
	
    pages.forEach((page) => index?.update(page));

	await saveSearchIndex();

	console.log("Sitemap data loaded successfully");
}


// Load data when the API server starts
// loadSitemapData().catch(console.error);

// we don't want to automatically load the sitemapdata, only if no index is present

loadSearchIndex().catch(console.error);

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("query");

    if (!index) {
        console.log("Search index is empty, loading...");
        await loadSitemapData();
    }

    if (!query) {
        return NextResponse.json({ error: "Query parameter is required" }, { status: 400 });
    }

	const results = Array.from(new Set(index!.search(query, {index: ["title","content","url"] })
	.flatMap((result:any) => result.result)))
	.map((id: number) => pages.find((page) => page.id === id));

    return NextResponse.json(results.flat());
}

export async function POST() {
	// this is to be used for the webhook to trigger a rebuild of the search index
    try {
        index = null; // Reset index
        await loadSitemapData(); // Rebuild index
		return NextResponse.json({ message: "Index updated successfully" });
    } catch (error) {
        console.error("Error updating index:", error);
        return NextResponse.json({ error: "Failed to update index" }, { status: 500 });
    }
}
