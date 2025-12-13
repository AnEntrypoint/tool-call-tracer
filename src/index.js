import { EventEmitter  } from 'events';
import { randomUUID  } from 'crypto';

class ToolCallTracer extends EventEmitter {
  constructor(maxCalls = 10000) {
    super();
    this.maxCalls = maxCalls;
    this.calls = [];
    this.callsByTool = new Map();
    this.callsByApp = new Map();
  }

  recordCall(appId, toolName, params = {}, startTime = Date.now()) {
    return {
      id: randomUUID(),
      appId,
      toolName,
      params,
      startTime,
      endTime: null,
      duration: 0,
      result: null,
      error: null,
      status: 'running',
      end: function(result, error = null) {
        this.endTime = Date.now();
        this.duration = this.endTime - this.startTime;
        if (error) {
          this.error = { message: error.message, stack: error.stack, type: error.constructor.name };
          this.status = 'error';
        } else {
          this.result = result;
          this.status = 'success';
        }
        return this;
      }
    };
  }

  async executeToolCall(appId, toolName, params, fn) {
    const call = this.recordCall(appId, toolName, params);

    this.calls.push(call);
    if (!this.callsByTool.has(toolName)) this.callsByTool.set(toolName, []);
    this.callsByTool.get(toolName).push(call.id);

    if (!this.callsByApp.has(appId)) this.callsByApp.set(appId, []);
    this.callsByApp.get(appId).push(call.id);

    if (this.calls.length > this.maxCalls) {
      const removed = this.calls.shift();
      const toolList = this.callsByTool.get(removed.toolName);
      if (toolList) {
        const idx = toolList.indexOf(removed.id);
        if (idx > -1) toolList.splice(idx, 1);
      }
    }

    this.emit('call:started', { id: call.id, appId, toolName });

    try {
      const result = await fn();
      call.end(result);
      this.emit('call:ended', { id: call.id, appId, toolName, duration: call.duration, status: 'success' });
      return result;
    } catch (error) {
      call.end(undefined, error);
      this.emit('call:ended', { id: call.id, appId, toolName, duration: call.duration, status: 'error', error: error.message });
      throw error;
    }
  }

  getCall(callId) {
    return this.calls.find(c => c.id === callId);
  }

  getCallsForTool(toolName, limit = 100) {
    const ids = this.callsByTool.get(toolName) || [];
    return ids.map(id => this.calls.find(c => c.id === id)).filter(Boolean).slice(-limit);
  }

  getCallsForApp(appId, limit = 100) {
    const ids = this.callsByApp.get(appId) || [];
    return ids.map(id => this.calls.find(c => c.id === id)).filter(Boolean).slice(-limit);
  }

  getStats() {
    const byStatus = { success: 0, error: 0, running: 0 };
    const byTool = {};
    let totalDuration = 0;
    let totalCalls = 0;

    this.calls.forEach(call => {
      byStatus[call.status]++;
      if (!byTool[call.toolName]) byTool[call.toolName] = { count: 0, totalDuration: 0, errors: 0 };
      byTool[call.toolName].count++;
      byTool[call.toolName].totalDuration += call.duration;
      if (call.status === 'error') byTool[call.toolName].errors++;
      if (call.status !== 'running') {
        totalDuration += call.duration;
        totalCalls++;
      }
    });

    const toolStats = Object.entries(byTool).map(([name, stats]) => ({
      tool: name,
      count: stats.count,
      avgDuration: stats.count > 0 ? Math.round(stats.totalDuration / stats.count) : 0,
      errors: stats.errors,
      errorRate: stats.count > 0 ? (stats.errors / stats.count * 100).toFixed(1) : 0
    }));

    return {
      totalCalls: this.calls.length,
      byStatus,
      avgDuration: totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0,
      tools: toolStats.sort((a, b) => b.count - a.count)
    };
  }

  getRecent(limit = 100) {
    return this.calls.slice(-limit).map(call => ({
      id: call.id,
      appId: call.appId,
      toolName: call.toolName,
      duration: call.duration,
      status: call.status,
      error: call.error?.message || null
    }));
  }

  clear() {
    this.calls = [];
    this.callsByTool.clear();
    this.callsByApp.clear();
  }
}

export { ToolCallTracer };
export const createToolCallTracer = (maxCalls) => new ToolCallTracer(maxCalls);
