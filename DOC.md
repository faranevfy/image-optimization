Image Optimization Setup with AWS CDK
This documentation provides step-by-step instructions to set up an image resizing server using AWS CDK, including installation, AWS credentials configuration, and deployment of an ImageOptimizationStack that serves images via a stable custom subdomain (img-cdn.evfy.in). The setup uses S3, CloudFront, Lambda, and a CloudFront Function for dynamic image resizing, with a cross-account DNS configuration (Account A for resources, Account B for DNS). It integrates with a Next.js v13 frontend and Payload CMS v2 backend.
Prerequisites

Node.js: Version 18.x or later (includes npm).
AWS Accounts:
Account A: Hosts S3, CloudFront, Lambda, and ACM certificate (us-east-1).
Account B: Hosts Route 53 for evfy.in.


Domain: evfy.in with a Route 53 hosted zone in Account B.
Existing S3 Bucket: Contains original images (e.g., your-original-bucket-name).
Payload CMS v2: Backend with productimages and images collections.
Next.js v13: Frontend for consuming images.
Git: For version control.
Terminal: Bash or equivalent.

Step 1: Install AWS CDK

Install Node.js (if not installed):

Download and install from nodejs.org (LTS version recommended).
Verify installation:node -v
npm -v


Expected output: v18.x.x or later for Node.js, 8.x.x or later for npm.


Install AWS CDK CLI:

Run globally:npm install -g aws-cdk


Verify installation:cdk --version


Expected output: 2.x.x (e.g., 2.140.0).


Bootstrap CDK in Account A:

Bootstrap the CDK environment in the region where resources will be deployed (e.g., us-east-1 for CloudFront):cdk bootstrap aws://<account-a-id>/us-east-1


Replace <account-a-id> with your Account A ID (12-digit number from AWS Console).
This creates a staging S3 bucket and IAM roles for CDK deployments.


Bootstrap CDK in Account B (Optional):

If deploying a DNS stack in Account B, bootstrap in the relevant region (e.g., us-east-1):cdk bootstrap aws://<account-b-id>/us-east-1





Step 2: Configure AWS Credentials

Create IAM User or Role:

In Account A, create an IAM user or role with AdministratorAccess (for simplicity) or least-privilege policies for S3, CloudFront, Lambda, ACM, IAM, and CloudWatch.
Example policies:
AmazonS3FullAccess
AmazonCloudFrontFullAccess
AWSLambda_FullAccess
AWSCertificateManagerFullAccess
IAMFullAccess
CloudWatchLogsFullAccess


In Account B, create a similar user/role for Route 53 access (AmazonRoute53FullAccess).


Generate Access Keys:

For the IAM user in Account A, generate an access key (Access Key ID and Secret Access Key) in the AWS Console (IAM → Users → Security credentials).
Repeat for Account B if deploying DNS via CDK.


Configure AWS CLI:

Install the AWS CLI if not installed:curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "AWSCLIV2.pkg"
sudo installer -pkg ./AWSCLIV2.pkg -target /
aws --version


Configure credentials for Account A:aws configure --profile account-a


Enter Access Key ID, Secret Access Key, region (e.g., us-east-1), and output format (e.g., json).


Configure for Account B:aws configure --profile account-b




Set Environment Variables:

For Account A deployments, set the profile:export AWS_PROFILE=account-a


For Account B, use:export AWS_PROFILE=account-b





Step 3: Set Up CDK Project

Create a CDK Project:

Initialize a new CDK project in TypeScript:mkdir image-optimization-cdk
cd image-optimization-cdk
cdk init app --language typescript




Install Dependencies:

Add AWS CDK libraries:npm install aws-cdk-lib@2.x aws-sdk


Install additional packages:npm install @aws-sdk/client-s3 sharp dotenv




Project Structure:

Organize files:image-optimization-cdk/
├── bin/
│   └── image-optimization-cdk.ts
├── lib/
│   └── image-optimization-stack.ts
├── functions/
│   ├── image-processing/
│   │   └── index.js
│   └── url-rewrite/
│       └── index.js
├── .env
├── package.json
├── tsconfig.json




Configure Environment Variables:

Create a .env file:originalImageBucketName=your-original-bucket-name
AWS_REGION=us-east-1


Replace your-original-bucket-name with your S3 bucket name.



Step 4: Implement ImageOptimizationStack
Update lib/image-optimization-stack.ts with the following code to manage S3, CloudFront, Lambda, CloudFront Function, and the custom domain img-cdn.evfy.in.
import {
  Fn,
  Stack,
  StackProps,
  RemovalPolicy,
  aws_s3 as s3,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_lambda as lambda,
  aws_iam as iam,
  Duration,
  CfnOutput,
  aws_logs as logs,
  aws_certificatemanager as acm,
} from 'aws-cdk-lib';
import { CfnDistribution } from 'aws-cdk-lib/aws-cloudfront';
import { Construct } from 'constructs';
import * as dotenv from 'dotenv';
dotenv.config();

const STORE_TRANSFORMED_IMAGES = 'true';
const S3_IMAGE_BUCKET_NAME = process.env.originalImageBucketName as string;
const CLOUDFRONT_ORIGIN_SHIELD_REGION = 'us-east-1';
const CLOUDFRONT_CORS_ENABLED = 'true';
const S3_TRANSFORMED_IMAGE_EXPIRATION_DURATION = '90';
const S3_TRANSFORMED_IMAGE_CACHE_TTL = 'max-age=31622400';
const MAX_IMAGE_SIZE = '4700000';
const LAMBDA_MEMORY = '1500';
const LAMBDA_TIMEOUT = '60';

type ImageDeliveryCacheBehaviorConfig = {
  origin: any;
  compress: any;
  viewerProtocolPolicy: any;
  cachePolicy: any;
  functionAssociations: any;
  responseHeadersPolicy?: any;
};

type LambdaEnv = {
  originalImageBucketName: string;
  transformedImageBucketName?: any;
  transformedImageCacheTTL: string;
  maxImageSize: string;
};

export class ImageOptimizationStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Original S3 bucket
    const originalImageBucket = s3.Bucket.fromBucketName(
      this,
      'imported-original-image-bucket',
      S3_IMAGE_BUCKET_NAME
    );
    new CfnOutput(this, 'OriginalImagesS3Bucket', {
      description: 'S3 bucket where original images are stored',
      value: originalImageBucket.bucketName,
    });

    // Transformed S3 bucket
    let transformedImageBucket;
    if (STORE_TRANSFORMED_IMAGES === 'true') {
      transformedImageBucket = new s3.Bucket(
        this,
        's3-transformed-image-bucket',
        {
          removalPolicy: RemovalPolicy.RETAIN,
          autoDeleteObjects: false,
          lifecycleRules: [
            {
              expiration: Duration.days(
                parseInt(S3_TRANSFORMED_IMAGE_EXPIRATION_DURATION)
              ),
            },
          ],
        }
      );
    }

    // Lambda environment variables
    const lambdaEnv: LambdaEnv = {
      originalImageBucketName: originalImageBucket.bucketName,
      transformedImageCacheTTL: S3_TRANSFORMED_IMAGE_CACHE_TTL,
      maxImageSize: MAX_IMAGE_SIZE,
    };
    if (transformedImageBucket)
      lambdaEnv.transformedImageBucketName = transformedImageBucket.bucketName;

    // IAM policy for S3 read
    const s3ReadOriginalImagesPolicy = new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [`arn:aws:s3:::${originalImageBucket.bucketName}/*`],
    });

    // Lambda IAM policies
    const iamPolicyStatements = [s3ReadOriginalImagesPolicy];
    if (transformedImageBucket) {
      const s3WriteTransformedImagesPolicy = new iam.PolicyStatement({
        actions: ['s3:PutObject'],
        resources: [`arn:aws:s3:::${transformedImageBucket.bucketName}/*`],
      });
      iamPolicyStatements.push(s3WriteTransformedImagesPolicy);
    }

    // Lambda for image processing
    const imageProcessing = new lambda.Function(
      this,
      'image-optimization',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: 'index.handler',
        code: lambda.Code.fromAsset('functions/image-processing'),
        timeout: Duration.seconds(parseInt(LAMBDA_TIMEOUT)),
        memorySize: parseInt(LAMBDA_MEMORY),
        environment: lambdaEnv,
        logRetention: logs.RetentionDays.ONE_DAY,
      }
    );

    // Enable Lambda URL
    const imageProcessingURL = imageProcessing.addFunctionUrl();

    // Extract Lambda URL domain
    const imageProcessingDomainName = Fn.parseDomainName(imageProcessingURL.url);

    // CloudFront origin group
    let imageOrigin;
    if (transformedImageBucket) {
      imageOrigin = new origins.OriginGroup({
        primaryOrigin: origins.S3BucketOrigin.withOriginAccessControl(
          transformedImageBucket,
          { originShieldRegion: CLOUDFRONT_ORIGIN_SHIELD_REGION }
        ),
        fallbackOrigin: new origins.HttpOrigin(imageProcessingDomainName, {
          originShieldRegion: CLOUDFRONT_ORIGIN_SHIELD_REGION,
        }),
        fallbackStatusCodes: [403, 500, 503, 504],
      });
    } else {
      imageOrigin = new origins.HttpOrigin(imageProcessingDomainName, {
        originShieldRegion: CLOUDFRONT_ORIGIN_SHIELD_REGION,
      });
    }

    // Attach IAM policy to Lambda
    imageProcessing.role?.attachInlinePolicy(
      new iam.Policy(this, 'read-write-bucket-policy', {
        statements: iamPolicyStatements,
      })
    );

    // CloudFront Function for URL rewriting
    const urlRewriteFunction = new cloudfront.Function(this, 'urlRewrite', {
      code: cloudfront.FunctionCode.fromFile({
        filePath: 'functions/url-rewrite/index.js',
      }),
      functionName: `urlRewriteFunction${this.node.addr}`,
    });

    // Cache policy with Accept header
    const cachePolicy = new cloudfront.CachePolicy(
      this,
      `ImageCachePolicy${this.node.addr}`,
      {
        defaultTtl: Duration.hours(24),
        maxTtl: Duration.days(365),
        minTtl: Duration.seconds(0),
        headerBehavior: cloudfront.CacheHeaderBehavior.allowList('Accept'),
      }
    );

    // Response headers policy for CORS
    let responseHeadersPolicy;
    if (CLOUDFRONT_CORS_ENABLED === 'true') {
      responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(
        this,
        `ResponseHeadersPolicy${this.node.addr}`,
        {
          responseHeadersPolicyName: `ImageResponsePolicy${this.node.addr}`,
          corsBehavior: {
            accessControlAllowCredentials: false,
            accessControlAllowHeaders: ['*'],
            accessControlAllowMethods: ['GET'],
            accessControlAllowOrigins: ['*'],
            accessControlMaxAge: Duration.seconds(600),
            originOverride: false,
          },
          customHeadersBehavior: {
            customHeaders: [
              { header: 'x-aws-image-optimization', value: 'v1.0', override: true },
              { header: 'vary', value: 'accept', override: true },
            ],
          },
        }
      );
    }

    // ACM certificate
    const certificate = acm.Certificate.fromCertificateArn(
      this,
      'ImageDeliveryCertificate',
      'arn:aws:acm:us-east-1:<account-a-id>:certificate/<certificate-id>' // Replace with your certificate ARN
    );

    // CloudFront distribution
    const imageDeliveryCacheBehaviorConfig: ImageDeliveryCacheBehaviorConfig = {
      origin: imageOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      compress: false,
      cachePolicy: cachePolicy,
      functionAssociations: [
        {
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          function: urlRewriteFunction,
        },
      ],
      responseHeadersPolicy: responseHeadersPolicy,
    };

    const imageDelivery = new cloudfront.Distribution(
      this,
      'imageDeliveryDistribution',
      {
        comment: 'image optimization - image delivery',
        defaultBehavior: imageDeliveryCacheBehaviorConfig,
        domainNames: ['img-cdn.evfy.in'],
        certificate: certificate,
        minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      }
    );

    // Origin Access Control for Lambda URL
    const oac = new cloudfront.CfnOriginAccessControl(this, 'OAC', {
      originAccessControlConfig: {
        name: `oac${this.node.addr}`,
        originAccessControlOriginType: 'lambda',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
      },
    });

    const cfnImageDelivery = imageDelivery.node.defaultChild as CfnDistribution;
    cfnImageDelivery.addPropertyOverride(
      `DistributionConfig.Origins.${
        STORE_TRANSFORMED_IMAGES === 'true' ? '1' : '0'
      }.OriginAccessControlId`,
      oac.getAtt('Id')
    );

    imageProcessing.addPermission('AllowCloudFrontServicePrincipal', {
      principal: new iam.ServicePrincipal('cloudfront.amazonaws.com'),
      action: 'lambda:InvokeFunctionUrl',
      sourceArn: `arn:aws:cloudfront::${this.account}:distribution/${imageDelivery.distributionId}`,
    });

    // Outputs
    new CfnOutput(this, 'ImageDeliveryDomain', {
      description: 'Domain name of image delivery',
      value: imageDelivery.distributionDomainName,
    });

    new CfnOutput(this, 'ImageDeliveryDistributionId', {
      description: 'CloudFront Distribution ID',
      value: imageDelivery.distributionId,
      exportName: 'ImageDeliveryDistributionId',
    });

    new CfnOutput(this, 'ImageDeliveryDomainExport', {
      description: 'CloudFront Domain Name',
      value: imageDelivery.distributionDomainName,
      exportName: 'ImageDeliveryDomain',
    });
  }
}

Notes:

Replace <account-a-id> and <certificate-id> with your ACM certificate ARN (find in AWS Console: ACM → Certificates).
Changed removalPolicy to RETAIN and autoDeleteObjects to false for the transformed bucket to prevent accidental data loss.
Added Accept header to cache policy for format selection (f=auto).
Uses existing certificate to avoid revalidation.

Step 5: Implement Lambda and CloudFront Function

Lambda Function (functions/image-processing/index.js):

Resizes images using Sharp and stores them in the transformed S3 bucket.

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import Sharp from 'sharp';

const s3Client = new S3Client();
const S3_ORIGINAL_IMAGE_BUCKET = process.env.originalImageBucketName;
const S3_TRANSFORMED_IMAGE_BUCKET = process.env.transformedImageBucketName;
const TRANSFORMED_IMAGE_CACHE_TTL = process.env.transformedImageCacheTTL;
const MAX_IMAGE_SIZE = parseInt(process.env.maxImageSize);

export const handler = async (event) => {
    if (!event.requestContext || !event.requestContext.http || !(event.requestContext.http.method === 'GET')) return sendError(400, 'Only GET method is supported', event);
    var imagePathArray = event.requestContext.http.path.split('/');
    var operationsPrefix = imagePathArray.pop();
    imagePathArray.shift();
    var originalImagePath = imagePathArray.join('/');

    var startTime = performance.now();
    let originalImageBody;
    let contentType;
    try {
        const getOriginalImageCommand = new GetObjectCommand({ Bucket: S3_ORIGINAL_IMAGE_BUCKET, Key: originalImagePath });
        const getOriginalImageCommandOutput = await s3Client.send(getOriginalImageCommand);
        console.log(`Got response from S3 for ${originalImagePath}`);
        originalImageBody = getOriginalImageCommandOutput.Body.transformToByteArray();
        contentType = getOriginalImageCommandOutput.ContentType;
    } catch (error) {
        if (error.name === "NoSuchKey") return sendError(404, "The requested image does not exist", error);
        return sendError(500, 'Error downloading original image', error);
    }
    const operationsJSON = Object.fromEntries(operationsPrefix.split(',').map(operation => operation.split('=')));
    console.log("operationsJSON", operationsJSON);

    if(operationsJSON['original']) {
        return {
            statusCode: 200,
            headers: { 'Content-Type': contentType },
            body: originalImageBody
        }
    }
    let transformedImage = Sharp(await originalImageBody, { failOn: 'none', animated: true });
    const imageMetadata = await transformedImage.metadata();
    var timingLog = 'img-download;dur=' + parseInt(performance.now() - startTime);
    startTime = performance.now();
    try {
        var resizingOptions = {};
        if (operationsJSON['width']) resizingOptions.width = parseInt(operationsJSON['width']);
        if (operationsJSON['height']) resizingOptions.height = parseInt(operationsJSON['height']);
        if (resizingOptions) transformedImage = transformedImage.resize({
            ...resizingOptions,
            fit: 'inside',
            withoutEnlargement: true
        });
        if (imageMetadata.orientation) transformedImage = transformedImage.rotate();
        if (operationsJSON['format']) {
            var isLossy = false;
            switch (operationsJSON['format']) {
                case 'jpeg': contentType = 'image/jpeg'; isLossy = true; break;
                case 'gif': contentType = 'image/gif'; break;
                case 'webp': contentType = 'image/webp'; isLossy = true; break;
                case 'png': contentType = 'image/png'; break;
                case 'avif': contentType = 'image/avif'; isLossy = true; break;
                default: contentType = 'image/jpeg'; isLossy = true;
            }
            if (operationsJSON['quality'] && isLossy) {
                transformedImage = transformedImage.toFormat(operationsJSON['format'], {
                    quality: parseInt(operationsJSON['quality']),
                });
            } else transformedImage = transformedImage.toFormat(operationsJSON['format']);
        } else {
            if (contentType === 'image/svg+xml') contentType = 'image/png';
        }
        transformedImage = await transformedImage.toBuffer();
    } catch (error) {
        return sendError(500, 'error transforming image', error);
    }
    timingLog = timingLog + ',img-transform;dur=' + parseInt(performance.now() - startTime);
    const imageTooBig = Buffer.byteLength(transformedImage) > MAX_IMAGE_SIZE;
    if (S3_TRANSFORMED_IMAGE_BUCKET) {
        startTime = performance.now();
        try {
            const putImageCommand = new PutObjectCommand({
                Body: transformedImage,
                Bucket: S3_TRANSFORMED_IMAGE_BUCKET,
                Key: originalImagePath + '/' + operationsPrefix,
                ContentType: contentType,
                CacheControl: TRANSFORMED_IMAGE_CACHE_TTL,
            });
            await s3Client.send(putImageCommand);
            timingLog = timingLog + ',img-upload;dur=' + parseInt(performance.now() - startTime);
            if (imageTooBig) {
                return {
                    statusCode: 302,
                    headers: {
                        'Location': '/' + originalImagePath + '?' + operationsPrefix.replace(/,/g, "&"),
                        'Cache-Control': 'private,no-store',
                        'Server-Timing': timingLog
                    }
                };
            }
        } catch (error) {
            logError('Could not upload transformed image to S3', error);
        }
    }
    if (imageTooBig) return sendError(403, 'Requested transformed image is too big', '');
    else return {
        statusCode: 200,
        body: transformedImage.toString('base64'),
        isBase64Encoded: true,
        headers: {
            'Content-Type': contentType,
            'Cache-Control': TRANSFORMED_IMAGE_CACHE_TTL,
            'Server-Timing': timingLog
        }
    };
};

function sendError(statusCode, body, error) {
    logError(body, error);
    return { statusCode, body };
}

function logError(body, error) {
    console.log('APPLICATION ERROR', body);
    console.log(error);
}


CloudFront Function (functions/url-rewrite/index.js):

Normalizes query parameters (e.g., ?f=auto&w=200&h=200&q=80).

function handler(event) {
    var request = event.request;
    var originalImagePath = request.uri;
    var normalizedOperations = {};
    if (request.querystring) {
        Object.keys(request.querystring).forEach(operation => {
            switch (operation.toLowerCase()) {
                case 'f': 
                    var SUPPORTED_FORMATS = ['auto', 'jpeg', 'webp', 'avif', 'png', 'svg', 'gif'];
                    if (request.querystring[operation]['value'] && SUPPORTED_FORMATS.includes(request.querystring[operation]['value'].toLowerCase())) {
                        var format = request.querystring[operation]['value'].toLowerCase();
                        if (format === 'auto') {
                            format = 'jpeg';
                            if (request.headers['accept']) {
                                if (request.headers['accept'].value.includes("avif")) format = 'avif';
                                else if (request.headers['accept'].value.includes("webp")) format = 'webp';
                            }
                        }
                        normalizedOperations['format'] = format;
                    }
                    break;
                case 'w':
                    if (request.querystring[operation]['value']) {
                        var width = parseInt(request.querystring[operation]['value']);
                        if (!isNaN(width) && (width > 0 && width <= 4000)) normalizedOperations['width'] = width.toString();
                    }
                    break;
                case 'h':
                    if (request.querystring[operation]['value']) {
                        var height = parseInt(request.querystring[operation]['value']);
                        if (!isNaN(height) && (height > 0 && height <= 4000)) normalizedOperations['height'] = height.toString();
                    }
                    break;
                case 'q':
                    if (request.querystring[operation]['value']) {
                        var quality = parseInt(request.querystring[operation]['value']);
                        if (!isNaN(quality) && (quality > 0 && quality <= 100)) normalizedOperations['quality'] = quality.toString();
                    }
                    break;
                default: break;
            }
        });
        if (Object.keys(normalizedOperations).length > 0) {
            var normalizedOperationsArray = [];
            if (normalizedOperations.format) normalizedOperationsArray.push('format='+normalizedOperations.format);
            if (normalizedOperations.quality) normalizedOperationsArray.push('quality='+normalizedOperations.quality);
            else normalizedOperationsArray.push('quality=80'); // Default quality
            if (normalizedOperations.width) normalizedOperationsArray.push('width='+normalizedOperations.width);
            if (normalizedOperations.height) normalizedOperationsArray.push('height='+normalizedOperations.height);
            request.uri = originalImagePath + '/' + normalizedOperationsArray.join(',');
        } else {
            request.uri = originalImagePath + '/original';
        }
    } else {
        request.uri = originalImagePath + '/original';
    }
    request['querystring'] = {};
    return request;
}


Install Lambda Dependencies:

In functions/image-processing, create package.json:{
  "name": "image-processing",
  "version": "1.0.0",
  "dependencies": {
    "@aws-sdk/client-s3": "^3.245.0",
    "sharp": "^0.32.6"
  }
}


Install:cd functions/image-processing
npm install
cd ../..





Step 6: Configure Cross-Account DNS in Account B

Remove img-cdn.evfy.in Hosted Zone:

In Account A’s Route 53 console, delete the img-cdn.evfy.in hosted zone.
In Account B’s evfy.in hosted zone, delete the NS records for img-cdn.evfy.in.


Create Alias Records:

In Account B’s Route 53, under evfy.in:
A Record:
Name: img-cdn.evfy.in
Type: A
Alias: Yes
Alias Target: CloudFront distribution (e.g., d12345678.cloudfront.net)


AAAA Record:
Name: img-cdn.evfy.in
Type: AAAA
Alias: Yes
Alias Target: Same CloudFront distribution






CDK Stack for DNS (Optional):

Create lib/dns-stack.ts in a separate CDK project in Account B:import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import { Fn, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class DnsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const hostedZone = route53.HostedZone.fromLookup(this, 'EvfyZone', {
      domainName: 'evfy.in',
    });

    const cloudFrontDomain = Fn.importValue('ImageDeliveryDomain');

    new route53.ARecord(this, 'ImageCdnAliasA', {
      zone: hostedZone,
      recordName: 'img-cdn.evfy.in',
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget({ domainName: cloudFrontDomain })
      ),
    });

    new route53.AaaaRecord(this, 'ImageCdnAliasAAAA', {
      zone: hostedZone,
      recordName: 'img-cdn.evfy.in',
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget({ domainName: cloudFrontDomain })
      ),
    });
  }
}


Update bin/dns-cdk.ts:#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DnsStack } from '../lib/dns-stack';

const app = new cdk.App();
new DnsStack(app, 'DnsStack', {
  env: { account: '<account-b-id>', region: 'us-east-1' },
});


Bootstrap and deploy:export AWS_PROFILE=account-b
cdk bootstrap aws://<account-b-id>/us-east-1
cdk deploy





Step 7: Deploy the Stack

Deploy in Account A:

Ensure .env is configured.
Deploy:export AWS_PROFILE=account-a
cdk diff
cdk deploy


CloudFront updates take 15–30 minutes.


Deploy DNS in Account B (if using CDK):

Follow Step 6.3.



Step 8: Update Next.js Frontend

Update Image Component:

In components/ProductImage.jsx:import React from 'react';

const ProductImage = ({ src, alt }) => {
  const cloudfrontUrl = process.env.NEXT_PUBLIC_CDN_URL || 'https://img-cdn.evfy.in';
  const baseSrc = `${cloudfrontUrl}${src}`;

  return (
    <picture>
      <source
        srcSet={`${baseSrc}?f=webp&w=400&h=300&q=80`}
        media="(max-width: 640px)"
        type="image/webp"
      />
      <source
        srcSet={`${baseSrc}?f=webp&w=800&h=600&q=80`}
        media="(max-width: 1024px)"
        type="image/webp"
      />
      <img
        src={`${baseSrc}?f=webp&w=1200&h=900&q=80`}
        alt={alt}
        sizes="(max-width: 640px) 400px, (max-width: 1024px) 800px, 1200px"
        loading="lazy"
      />
    </picture>
  );
};

export default ProductImage;




Configure Environment:

In .env.local:NEXT_PUBLIC_CDN_URL=https://img-cdn.evfy.in





Step 9: Test and Monitor

Verify SSL:

Test: https://img-cdn.evfy.in/some-image.jpeg
Use: ssllabs.com/ssltest


Test DNS:

Run: dig img-cdn.evfy.in


Non-Destructive Updates:

Update Lambda code, then:cdk diff
cdk deploy




Monitor:

Check CloudWatch for CloudFront and Lambda logs.
Verify cache hits (x-cache: Hit from cloudfront).



Troubleshooting

SSL Issues: Ensure certificate ARN is correct and alias records point to CloudFront.
DNS Propagation: Wait 24–48 hours or check with dig.
CDK Errors: Verify AWS credentials and region.
