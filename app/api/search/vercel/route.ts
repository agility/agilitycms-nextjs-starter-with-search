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

const isDevMode = () => process.env.NODE_ENV === "development";

async function deleteAllBlobs(prefix: string) {
  console.log("Deleting all blobs with prefix:", prefix);
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
    console.log("Saving search index to Blob");
    const prefix = "search-index";
    await deleteAllBlobs(prefix);

    await index.export(async (key, data) => {
      console.log("saving key", key);
      console.log("saving data", data);

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
  console.log("Loading search index from Blob");
  const prefix = "search-index";
  const listData = await list({
    prefix,
    token: isDevMode()
      ? process.env.DEV_BLOB_READ_WRITE_TOKEN
      : process.env.BLOB_READ_WRITE_TOKEN,
  });

  // if there's no data in blob storage, rebuild the index from the sitemap
  if (listData.blobs.length === 0) {
    console.log("No search index found in Blob");
    await loadSitemapData().catch(console.error);
  }

  // if no index exists, create a new one
  if (!index) {
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
  }

  // if no Blob data has been written yet, fetch the site data

  for (const blob of listData.blobs) {
    const key = blob.pathname.replace("search-index/", "").replace(".json", "");
    const blobData = await fetch(blob.url);
    const response = await blobData.json();
    if (response) {
      index.import(key, response);
    }
  }

}

async function loadSitemapData() {

  const isDevelopmentMode = process.env.NODE_ENV === "development";
  const isPreview = isDevelopmentMode;

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

  console.log("Sitemap->", sitemap);

  const pagePromises = Object.keys(sitemap).map(async (path) => {
    const data = await api.getPageByPath({
      pagePath: path,
      languageCode: process.env.AGILITY_LOCALES,
      channelName: process.env.AGILITY_SITEMAP || "website",
      contentLinkDepth: 4,
    });

    const { sitemapNode } = data;

    const pageContent = Object.keys(data.page.zones)
      .map((zoneKey) => {
        const zone = data.page.zones[zoneKey];

        return zone
          .map((module: any) => {
            let response = "";
            if (module.module === "PostDetails") {
              response = data.contentItem.fields.content;
            }

            if (module.module === "RichTextArea") {
              response = module.item.fields.textblob;
            }

            if (module.module === "TextBlockWithImage") {
              response = module.item.fields.content;
            }

            const strippedContent = response
              .replace(/<\/?[^>]+(>|$)/g, "")
              .replace(/[\r\n]+/g, " ");
            if (strippedContent !== "") {
              return strippedContent;
            }
          })
          .join(" "); // Join modules into a single string
      })
      .join(" "); // Join zones into a single string


	  console.log("page->", sitemapNode.path);
    return {
      id: sitemapNode.path,
      title: sitemapNode.title,
      content: pageContent,
      url: sitemapNode.path,
    };
  });

  pages = await Promise.all(pagePromises);
  pages.forEach((page) => index?.add(page));

  await saveSearchIndex();

}

// Load data when the API server starts
// loadSitemapData().catch(console.error);

// we don't want to automatically load the sitemapdata, only if no index is present

// automatically load the search index on the first request
loadSearchIndex().catch(console.error);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("query");

  if (!index) {
    console.log("Search index is empty...");
    await loadSearchIndex();
  }

  if (!query) {
    return NextResponse.json(
      { error: "Query parameter is required" },
      { status: 400 }
    );
  }

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
