#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ImageOptimizationStack } from '../lib/image-optimization-stack';
import { TestImageStack } from '../lib/test-image-stack';


const app = new cdk.App();
new ImageOptimizationStack(app, 'ImgTransformationStack', {
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});

new TestImageStack(app, 'TestImageStack', {                  // ← NEW
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
