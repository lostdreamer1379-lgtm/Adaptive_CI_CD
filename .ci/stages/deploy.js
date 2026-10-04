#!/usr/bin/env node
/**
 * Adaptive Deploy Stage
 * Reads CI_PROFILE and deploys to the detected platform.
 */
const { execSync } = require('child_process');
const profile = JSON.parse(process.env.CI_PROFILE || '{}');

function run(cmd, env = {}) {
  console.log(`\n▶ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });
}

function requireEnv(name) {
  if (!process.env[name]) {
    console.error(`❌ Missing required secret: ${name}`);
    process.exit(1);
  }
  return process.env[name];
}

function deploy() {
  const { deployTarget, name } = profile;

  console.log(`\n🚀 Deploying to: ${deployTarget}\n`);

  switch (deployTarget) {

    case 'vercel': {
      requireEnv('VERCEL_TOKEN');
      requireEnv('VERCEL_ORG_ID');
      requireEnv('VERCEL_PROJECT_ID');
      run('npm install -g vercel@latest');
      run('vercel pull --yes --environment=production --token=$VERCEL_TOKEN');
      run('vercel build --prod --token=$VERCEL_TOKEN');
      run('vercel deploy --prebuilt --prod --token=$VERCEL_TOKEN');
      break;
    }

    case 'netlify': {
      requireEnv('NETLIFY_AUTH_TOKEN');
      requireEnv('NETLIFY_SITE_ID');
      run('npm install -g netlify-cli');
      run('netlify deploy --prod --dir=dist --auth=$NETLIFY_AUTH_TOKEN --site=$NETLIFY_SITE_ID');
      break;
    }

    case 'fly': {
      requireEnv('FLY_API_TOKEN');
      run('curl -L https://fly.io/install.sh | sh');
      run('fly deploy --remote-only', { FLY_API_TOKEN: process.env.FLY_API_TOKEN });
      break;
    }

    case 'railway': {
      requireEnv('RAILWAY_TOKEN');
      run('npm install -g @railway/cli');
      run('railway up --detach', { RAILWAY_TOKEN: process.env.RAILWAY_TOKEN });
      break;
    }

    case 'render': {
      requireEnv('RENDER_API_KEY');
      // Render auto-deploys from git push; we trigger a manual deploy via API as backup
      run(`curl -X POST https://api.render.com/v1/services/${process.env.RENDER_SERVICE_ID}/deploys \
        -H "Authorization: Bearer ${process.env.RENDER_API_KEY}" \
        -H "Content-Type: application/json" \
        -d '{"clearCache": false}'`);
      break;
    }

    case 'heroku': {
      run('npm install -g heroku');
      run('heroku container:login');
      run('heroku container:push web');
      run('heroku container:release web');
      break;
    }

    case 'kubernetes': {
      run('kubectl apply -f k8s/');
      run(`kubectl rollout status deployment/${name}`);
      break;
    }

    case 'docker': {
      // Docker deploy is handled by the docker job in the workflow
      console.log('ℹ️  Docker image build + push handled by the docker job.');
      break;
    }

    case 'aws': {
      // Generic AWS — detect sub-target
      const fs = require('fs');
      if (fs.existsSync('appspec.yml')) {
        run('aws deploy create-deployment --application-name $APP_NAME --deployment-group-name production');
      } else if (fs.existsSync('template.yaml') || fs.existsSync('serverless.yml')) {
        run('npx serverless deploy --stage production');
      } else {
        run('aws s3 sync dist/ s3://$S3_BUCKET --delete');
        run('aws cloudfront create-invalidation --distribution-id $CF_DIST_ID --paths "/*"');
      }
      break;
    }

    default:
      console.log(`⚠️  No deploy target detected (found: "${deployTarget}") — skipping deploy.`);
      console.log('   Add a vercel.json, netlify.toml, fly.toml, or Dockerfile to enable auto-deploy.');
  }

  console.log('\n✅ Deploy complete!');
}

deploy();
