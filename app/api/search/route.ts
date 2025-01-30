import FlexSearch from "flexsearch";
import agility from '@agility/content-fetch'
import { NextResponse } from "next/server";


// Create the search index
let index: FlexSearch.Index | null = null;
let pages: { id: number; title: string; content: string; slug: string }[] = [];

// Function to load the sitemap data once
async function loadSitemapData() {

	if (index !== null) return; // Prevent reloading on every request

    console.log("Loading sitemap data...");

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
	
	const pagePromises = Object.keys(sitemap).map(async (path, index) => {
		const data = await api.getPageByPath({
			pagePath: path,
			languageCode: process.env.AGILITY_LOCALES,
			channelName: process.env.AGILITY_SITEMAP || 'website',
			contentLinkDepth: 4,
		});

		const { sitemapNode } = data;

		// this gets all the content from the page zones
		const pageContent = Object.keys(data.page.zones).map((zoneKey) => {
			const zone = data.page.zones[zoneKey];
			return zone.map((module: any) => {
				const content = Object.values(module.item.fields).reduce((acc: string, field: any) => {
					if (typeof field === 'string') {
						// Strip HTML tags and remove newlines
						const strippedContent = field.replace(/<\/?[^>]+(>|$)/g, "").replace(/[\r\n]+/g, " ");
						return acc + ' ' + strippedContent;
					}
					return acc;
				}, '');
				return content;
			}).join(' ');
		}).join(' ');

		return {
			id: sitemapNode.pageID,
			title: sitemapNode.title,
			content: pageContent,
			slug: sitemapNode.path,
		}
	});

	pages = await Promise.all(pagePromises);
	index = new FlexSearch.Index();
    pages.forEach(({ id, title, content }) => index?.add(id, `${title} ${content}`));

}

// Load data when the API server starts
loadSitemapData().catch(console.error);


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

    const results = index!.search(query).map((id) => pages.find((page) => page.id === id));

    return NextResponse.json(results);
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
