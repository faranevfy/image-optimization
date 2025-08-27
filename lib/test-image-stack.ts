// lib/test-image-stack.ts
import {
  Stack,
  StackProps,
  RemovalPolicy,
  Duration,
  CfnOutput,
  aws_iam as iam,
  aws_logs as logs,
  Fn,
  aws_s3 as s3,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_lambda as lambda,
} from "aws-cdk-lib";
import { Construct } from "constructs";
// import * as s3 from "aws-cdk-lib/aws-s3";
// import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
// import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
// import * as lambda from "aws-cdk-lib/aws-lambda";
// import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
// import * as path from "path";
import { getOriginShieldRegion } from "./origin-shield";

type LambdaEnv = {
  originalImageBucketName: string;
  transformedImageBucketName?: any;
  transformedImageCacheTTL: string;
  maxImageSize: string;
};

const ORIGINAL_S3_BUCKET_NAME_TEST = "evfy-test";
const CLOUDFRONT_ORIGIN_SHIELD_REGION = getOriginShieldRegion("ap-south-1");

export class TestImageStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const testOriginalBucket = s3.Bucket.fromBucketName(
      this,
      "evfy-test-original-images",
      ORIGINAL_S3_BUCKET_NAME_TEST
    );
    new CfnOutput(this, "OriginalImagesS3BucketForTest", {
      description: "S3 bucket where original images are stored",
      value: testOriginalBucket.bucketName,
    });
    const testTransformedBucket = new s3.Bucket(this, "TestTransformedBucket", {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          expiration: Duration.days(1),
        },
      ],
    });

    // const sharpLayerWithHeicSupport = lambda.LayerVersion.fromLayerVersionArn(
    //   this,
    //   "SharpLayerWithHeicSupport",
    //   "arn:aws:lambda:ap-south-1:590773717254:layer:sharp-heic-layer:1" // Replace with your actual ARN
    // );

    let testLambdaEnv: LambdaEnv = {
      originalImageBucketName: testOriginalBucket.bucketName,
      transformedImageBucketName: testTransformedBucket.bucketName,
      transformedImageCacheTTL: "max-age=86400",
      maxImageSize: "5000000",
    };

    const s3ReadOriginalImagesPolicyForTest = new iam.PolicyStatement({
      actions: ["s3:GetObject", "s3:ListBucket"],
      resources: [
        "arn:aws:s3:::" + testOriginalBucket.bucketName + "/*",
        "arn:aws:s3:::" + testOriginalBucket.bucketName,
      ],
    });
    let testIamPolicyStatements = [s3ReadOriginalImagesPolicyForTest];

    const testImageLambda = new lambda.Function(this, "TestImageLambda", {
      code: lambda.Code.fromAsset("functions/test-heic"),
      handler: "index.handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 1024,
      timeout: Duration.seconds(60),
      environment: testLambdaEnv,
    //   layers: [sharpLayerWithHeicSupport],
      logRetention: logs.RetentionDays.ONE_DAY,
    });

    const testLambdaURL = testImageLambda.addFunctionUrl();

    const testLambdaDomainName = Fn.parseDomainName(testLambdaURL.url);

    let testImageOrigin = new origins.OriginGroup({
      primaryOrigin: origins.S3BucketOrigin.withOriginAccessControl(
        testTransformedBucket,
        {
          originShieldRegion: CLOUDFRONT_ORIGIN_SHIELD_REGION,
        }
      ),
      fallbackOrigin: new origins.HttpOrigin(testLambdaDomainName, {
        originShieldRegion: CLOUDFRONT_ORIGIN_SHIELD_REGION,
      }),
      fallbackStatusCodes: [403, 500, 503, 504],
    });

    let testS3WriteTransformedImagesPolicy = new iam.PolicyStatement({
      actions: ["s3:PutObject"],
      resources: [
        "arn:aws:s3:::" + testTransformedBucket.bucketName + "/*",
        "arn:aws:s3:::" + testTransformedBucket.bucketName,
      ],
    });

    testIamPolicyStatements.push(testS3WriteTransformedImagesPolicy);

    testImageLambda.role?.attachInlinePolicy(
      new iam.Policy(this, "test-read-write-bucket-policy", {
        statements: testIamPolicyStatements,
      })
    );

    // testOriginalBucket.grantRead(testImageLambda);
    // testTransformedBucket.grantReadWrite(testImageLambda);

    const testUrlRewriteFunction = new cloudfront.Function(
      this,
      "TestUrlRewrite",
      {
        code: cloudfront.FunctionCode.fromFile({
          filePath: "functions/url-rewrite/test.js",
        }),
        functionName: `TestUrlRewrite${this.node.addr}`,
        runtime: cloudfront.FunctionRuntime.JS_2_0
      }
    );

    let testImageDeliveryCacheBehaviourConfig = {
      origin: testImageOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      compress: true,
      cachePolicy: new cloudfront.CachePolicy(
        this,
        `TestImageDeliveryCachePolicy${this.node.addr}`,
        {
          defaultTtl: Duration.hours(24),
          maxTtl: Duration.days(365),
          minTtl: Duration.seconds(0),
        }
      ),
      functionAssociations: [
        {
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          function: testUrlRewriteFunction,
        },
      ],
    };

    const testImageCloudfront = new cloudfront.Distribution(
      this,
      "testImageDeliveryDistribution",
      {
        defaultBehavior: testImageDeliveryCacheBehaviourConfig,
        comment: "testImageDeliveryDistribution - for heic images",
      }
    );

    const oac = new cloudfront.CfnOriginAccessControl(this, "TEST-OAC", {
      originAccessControlConfig: {
        name: `TEST-OAC${this.node.addr}`,
        originAccessControlOriginType: "lambda",
        signingBehavior: "always",
        signingProtocol: "sigv4",
      },
    });

    const cfnImageDelivery = testImageCloudfront.node
      .defaultChild as cloudfront.CfnDistribution;
    cfnImageDelivery.addPropertyOverride(
      `DistributionConfig.Origins.${"1"}.OriginAccessControlId`,
      oac.getAtt("Id")
    );

    testImageLambda.addPermission("AllowCloudFrontServicePrincipal", {
      principal: new iam.ServicePrincipal("cloudfront.amazonaws.com"),
      action: "lambda:InvokeFunctionUrl",
      sourceArn: `arn:aws:cloudfront::${this.account}:distribution/${testImageCloudfront.distributionId}`,
    });

    // const cfDistribution = new cloudfront.Distribution(this, "TestImageCDN", {
    //   defaultBehavior: {
    //     origin: new origins.HttpOrigin(
    //       `${testImageLambda.functionName}.lambda-url.ap-south-1.on.aws`,
    //       {
    //         protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    //       }
    //     ),
    //     cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
    //     viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    //   },
    // });

    new CfnOutput(this, "TestImageCloudFrontURL", {
      value: testImageCloudfront.domainName,
      description: "Test Image CloudFront URL",
    });
  }
}
