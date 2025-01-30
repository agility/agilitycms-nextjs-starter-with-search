import { Page } from "@agility/content-fetch";
import FlexSearch from 'flexsearch'
import { del, list, put } from '@vercel/blob'; // remove if not using Vercel
import { getContentItem } from "lib/cms/getContentItem";
import fs from 'fs';
import path from 'path';

interface PageData {
    id: number,
    title: string,
    path: string,
    content?: string
}

const index = new FlexSearch.Document({
    tokenize: 'full',
    document: {
      id: 'id',
      index: ['title', 'path', 'content'], // fields you want to search against
      store: ['title', 'path', 'content'], // fields you want to store data on
    },
    context: {
      resolution: 9,
      depth: 2,
      bidirectional: true,
    },
  })
  

async function loadIndexFromLocal() {

    const files = fs.readdirSync(path.join(__dirname, 'blob'));

    for (const file of files) {
        const filePath = path.join(__dirname, 'blob', file);
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const pageData = JSON.parse(fileContent);
        index.add(pageData);
    }

    return index

}

async function loadIndexFromVercelBlob() {
    // const isDevMode = () => process.env.NODE_ENV === 'development';
    // let sections: any = {};

    // const listData = await list({
    //   prefix: path ? path : undefined,
    //   token: isDevMode() ? process.env.DEV_BLOB_READ_WRITE_TOKEN : process.env.BLOB_READ_WRITE_TOKEN 
    // })

    // for (const blob of listData.blobs) {
    //   const blobData = await fetch(blob.url);
    //   const response = await blobData.json();
    //   if(response && response.length > 0) {
    //     sections[response[0]?.path] = response;
    //   }
    // }
    
    // return sections;

}

async function loadIndexFromAzureBlob() {
   

}

async function loadIndexFromS3Bucket() {

}

async function addPageToLocal(page: any) {
    try {

        const fileName = page.path.replace(/\//g, '-').replace(/^-/, '');
        const dirPath = path.join(__dirname, 'blob');
        const filePath = path.join(dirPath, `${fileName}.json`);

        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath);
        }

        fs.writeFileSync(filePath, JSON.stringify(page, null, 2));

    } catch(error) {
        console.error(error)
    }
}

async function addPageToVercelBlob(page: Page) {
    
    
//   const isDevMode = () => process.env.NODE_ENV === 'development';

//   if (currentPath.startsWith('/')) {
//     currentPath = currentPath.substring(1);
//   }

//   async function deleteAllBlobs() {
//     let cursor;
   
//     do {
//       const listResult:any = await list({
//         cursor,
//         limit: 1000,
//         prefix: currentPath.split('/').join('-'),
//       });
   
//       if (listResult.blobs.length > 0) {
//         await del(listResult.blobs.map((blob:any) => blob.url));
//       }
   
//       cursor = listResult.cursor;
//     } while (cursor);
//   }

//   deleteAllBlobs()
  
//   const sectionData:any = {}
//   sectionData[currentPath] = sections;
//   await put(currentPath.split('/').join('-') + '/sections.json', JSON.stringify(sections), { access: 'public', contentType: 'application/json', token: isDevMode() ? process.env.DEV_BLOB_READ_WRITE_TOKEN : process.env.BLOB_READ_WRITE_TOKEN });
  
}

async function addPageToAzureBlob(page: Page) {
    
}

async function addPageToS3Bucket(page: Page) {
    
}

export async function search(query: string, options: any = {}) {

    try {  

       const index = await loadIndexFromLocal() as any;
       //const index = await loadIndexFromVercelBlob() as any;
       //const index = await loadIndexFromAzureBlob() as any;
       //const index = await loadIndexFromS3Bucket() as any;
        
        
       if (index) {
        const result =
          (await index?.search(query, {
            ...options,
            enrich: true,
          })) || []
  
        if (result?.length === 0) {
          return []
        }
  
        return result[0]?.result?.map((item: any) => {
          //   console.log('search item:', item)
          return {
            url: item.doc.url,
            title: item.doc.title,
            pageTitle: item.doc.pageTitle,
            // section: item.doc.section,
            path: item.doc.path,
          }
        })
      } else {
        console.log('No index to search yet')
      }
    } catch (error) {
      console.error('Error searching index:', error)
      return []
    }
  }  




export async function addPageToSearch(page: any){
    
    const { sitemapNode } = page
    const { path, title , pageID} = sitemapNode

    // Add the page to the search index
    const pageData:PageData = {
        id: pageID,
        title,
        path
    }

    // lets get the content from the page components and add those to the search as well
    const { zones } = page.page
    const allContent = await Promise.all(
        Object.entries(zones).flatMap(([zone, ContentZone]: [string, any]) => 
            ContentZone.map(async (module: any) => {
                // const contentItem = await getContentItem({
                //     contentID: module.item.contentid,
                //     locale: process.env.AGILITY_LOCALES
                // });
    
                // // you may need to adjust this to return your content model
                // return (contentItem as any)?.fields?.content || '';
            })
        )
    );
    // join all the content together
    pageData.content = allContent.join(' ')

    // we may also want to look at the dynamicPageItem and add that to the search index
   
    return await addPageToLocal(pageData)

    // You could also use
    // return await addPageToVercelBlob(page)  
    // return await addPageToAzureBlob(page)
    // return await addPageToS3Bucket(page)


}