# Introduction to Search

Search works around storing your page data in a BLOB file that can be quickly searched by FlexSearch a JavaScript library designed for
lightnight fast searching. 

1. Local File System Storage
This does not work on edge services. 

2. Vercel BLOB Storage
@vercel/blob

3. S3 Buckets
@aws-sdk/client-s3

4. Azure Blob Storage
@azure/storage-blob



## Webhook Updates

In order to keep your blob storage in sync with your Agility CMS data, we need to setup a webhook for receiving
updates and publishes of content.