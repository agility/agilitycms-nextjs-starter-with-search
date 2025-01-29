import { revalidatePath, revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

interface IRevalidateRequest {
	state: string,
	instanceGuid: string
	languageCode: string
	referenceName?: string
	contentID?: number
	contentVersionID?: number
	pageID?: number
	pageVersionID?: number
	changeDateUTC: string
}

export async function POST(req: NextRequest) {

	//parse the body
	const data = await req.json() as IRevalidateRequest

	console.log(data)


	if(data.state === "Preview"){
		  

			// update the search index



	}
	//only process publish events
	if (data.state === "Published") {

		   // update the search index
	}

	return NextResponse.json({ message: "OK" }, { status: 200 });


}