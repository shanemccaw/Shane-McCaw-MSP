import { Router, Request, Response } from 'express';
import { PccStateManager } from '../lib/pcc/state-manager.js';
import { PccStreamingServer } from '../lib/pcc/streaming-server.js';
import { PccTestRunner } from '../lib/pcc/test-runner.js';
import { PccEventInjector } from '../lib/pcc/event-injector.js';
import { DEFAULT_TESTS } from '../lib/pcc/taxonomy-catalog.js';

const router = Router();
const stateManager = PccStateManager.getInstance();
const streamingServer = PccStreamingServer.getInstance();
const testRunner = new PccTestRunner();
const eventInjector = new PccEventInjector();

// 1. Get taxonomy catalog
router.get('/catalog', (req: Request, res: Response) => {
  res.json({ tests: DEFAULT_TESTS });
});

// 2. Get state details
router.get('/state', (req: Request, res: Response) => {
  res.json({
    environment: stateManager.getEnvironment(),
    replayMode: stateManager.getReplayMode(),
    progress: stateManager.getReplayProgress(),
    playbackSpeed: stateManager.getPlaybackSpeed()
  });
});

// 3. Update environment gating
router.post('/environment', (req: Request, res: Response) => {
  const { environment } = req.body;
  if (environment === 'dev' || environment === 'test' || environment === 'prod') {
    stateManager.setEnvironment(environment);
    res.json({ success: true, environment });
  } else {
    res.status(400).json({ error: 'Invalid environment. Must be dev, test, or prod.' });
  }
});

// 4. Trigger test runner sequence
router.post('/run', async (req: Request, res: Response) => {
  const { tags } = req.body;
  try {
    const results = await testRunner.runSuite(tags || []);
    res.json({ success: true, runId: stateManager.getCurrentRunId(), results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Inject events
router.post('/inject', (req: Request, res: Response) => {
  const { eventType, payload } = req.body;
  if (!eventType) {
    res.status(400).json({ error: 'eventType is required' });
    return;
  }
  const result = eventInjector.inject(eventType, payload || {});
  res.json(result);
});

// 6. Timeline Replay configuration
router.post('/replay/config', (req: Request, res: Response) => {
  const { mode, speed, day, tick } = req.body;
  if (mode) stateManager.setReplayMode(mode);
  if (speed) stateManager.setPlaybackSpeed(speed);
  if (day !== undefined && tick !== undefined) {
    stateManager.setReplayProgress(day, tick);
  }
  res.json({ success: true });
});

// 7. Real-time Event Stream (SSE)
router.get('/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  streamingServer.registerClient(res);

  req.on('close', () => {
    streamingServer.unregisterClient(res);
  });
});

export default router;
