import type { FastifyInstance } from 'fastify';
import type { ModelEngine, ModelRecommender, TaskPreference } from '@krythor/models';
import { TaskClassifier } from '@krythor/models';
import type { GuardEngine } from '@krythor/guard';
import { logger } from '../logger.js';

// ─── Recommendation routes ────────────────────────────────────────────────────
//
// GET  /api/recommend?task=<text>     — classify + recommend model for task text
// GET  /api/recommend/preferences     — list all user task-type preferences
// PUT  /api/recommend/preferences/:taskType — set preference for a task type
// DELETE /api/recommend/preferences/:taskType — clear preference
//

const classifier = new TaskClassifier();

export function registerRecommendRoutes(
  app: FastifyInstance,
  models: ModelEngine,
  recommender: ModelRecommender,
  guard?: GuardEngine,
): void {

  // GET /api/recommend?task=<text>
  app.get<{ Querystring: { task?: string } }>('/api/recommend', async (req, reply) => {
    const taskText = req.query.task ?? '';
    if (!taskText.trim()) {
      return reply.code(400).send({ error: 'Query param "task" is required' });
    }

    const classification = classifier.classify(taskText);
    const recommendation = recommender.recommend(classification.taskType);

    if (recommendation) {
      logger.recommendationMade(
        classification.taskType,
        recommendation.modelId,
        recommendation.providerId,
        recommendation.confidence,
      );
    }

    return reply.send({
      classification,
      recommendation,
      availableModels: models.listModels().filter(m => m.isAvailable),
    });
  });

  // GET /api/recommend/preferences
  app.get('/api/recommend/preferences', async (_req, reply) => {
    return reply.send(recommender.listPreferences());
  });

  // PUT /api/recommend/preferences/:taskType
  app.put<{ Params: { taskType: string } }>('/api/recommend/preferences/:taskType', {
    schema: {
      body: {
        type: 'object',
        required: ['modelId', 'providerId', 'preference'],
        properties: {
          modelId:    { type: 'string', minLength: 1, maxLength: 200 },
          providerId: { type: 'string', minLength: 1, maxLength: 200 },
          preference: { type: 'string', enum: ['always_use', 'ask', 'auto'] },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { taskType } = req.params;
    const body = req.body as { modelId: string; providerId: string; preference: TaskPreference['preference'] };

    // Verify the model actually exists
    const available = models.listModels();
    const modelExists = available.some(m => m.id === body.modelId && m.providerId === body.providerId);
    if (!modelExists) {
      return reply.code(404).send({ error: 'Model not found — can only pin configured models' });
    }

    recommender.setPreference({ taskType, ...body });
    return reply.send({ taskType, ...body });
  });

  // DELETE /api/recommend/preferences/:taskType
  app.delete<{ Params: { taskType: string } }>('/api/recommend/preferences/:taskType', async (req, reply) => {
    recommender.clearPreference(req.params.taskType);
    return reply.code(204).send();
  });

  // POST /api/recommend/override — log that user overrode a recommendation
  app.post('/api/recommend/override', {
    schema: {
      body: {
        type: 'object',
        required: ['taskType', 'suggestedModelId', 'chosenModelId'],
        properties: {
          taskType:         { type: 'string', minLength: 1, maxLength: 100 },
          suggestedModelId: { type: 'string', minLength: 1, maxLength: 200 },
          chosenModelId:    { type: 'string', minLength: 1, maxLength: 200 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { taskType, suggestedModelId, chosenModelId } = req.body as {
      taskType: string; suggestedModelId: string; chosenModelId: string;
    };
    logger.recommendationOverridden(taskType, suggestedModelId, chosenModelId);
    return reply.code(204).send();
  });
}
