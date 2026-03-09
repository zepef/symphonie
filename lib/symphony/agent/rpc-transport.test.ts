import { describe, it, expect } from 'vitest'
import { createRpcTransport } from './rpc-transport'
import type { JsonRpcRequest } from './protocol'

function makeTransport() {
  const written: string[] = []
  const transport = createRpcTransport((line) => written.push(line))
  return { transport, written }
}

describe('createRpcTransport', () => {
  describe('nextId', () => {
    it('returns incrementing integers', () => {
      const { transport } = makeTransport()
      const id1 = transport.nextId()
      const id2 = transport.nextId()
      expect(id2).toBe(id1 + 1)
    })
  })

  describe('sendRaw', () => {
    it('writes JSON-serialised message followed by newline', () => {
      const { transport, written } = makeTransport()
      transport.sendRaw({ jsonrpc: '2.0', method: 'initialized' })
      expect(written).toHaveLength(1)
      expect(JSON.parse(written[0])).toMatchObject({ method: 'initialized' })
    })
  })

  describe('sendRequest / handleResponseLine', () => {
    it('resolves when handleResponseLine is called with matching id', async () => {
      const { transport } = makeTransport()
      const id = transport.nextId()
      const req: JsonRpcRequest = { jsonrpc: '2.0', id, method: 'test', params: {} }
      const promise = transport.sendRequest(req)

      const consumed = transport.handleResponseLine({ id, result: { ok: true } })
      expect(consumed).toBe(true)

      const resp = await promise
      expect(resp.result).toEqual({ ok: true })
    })

    it('returns false for non-response messages', () => {
      const { transport } = makeTransport()
      const consumed = transport.handleResponseLine({ method: 'session_started', params: {} })
      expect(consumed).toBe(false)
    })

    it('returns false when id is unknown', () => {
      const { transport } = makeTransport()
      const consumed = transport.handleResponseLine({ id: 9999, result: {} })
      expect(consumed).toBe(false)
    })
  })

  describe('rejectAll', () => {
    it('rejects all pending promises with the given reason', async () => {
      const { transport } = makeTransport()
      const id1 = transport.nextId()
      const id2 = transport.nextId()
      const req1: JsonRpcRequest = { jsonrpc: '2.0', id: id1, method: 'a', params: {} }
      const req2: JsonRpcRequest = { jsonrpc: '2.0', id: id2, method: 'b', params: {} }

      const p1 = transport.sendRequest(req1)
      const p2 = transport.sendRequest(req2)

      transport.rejectAll(new Error('Process closed'))

      await expect(p1).rejects.toThrow('Process closed')
      await expect(p2).rejects.toThrow('Process closed')
    })

    it('clears pending map after rejectAll (subsequent handleResponseLine is a no-op)', async () => {
      const { transport } = makeTransport()
      const id = transport.nextId()
      const req: JsonRpcRequest = { jsonrpc: '2.0', id, method: 'x', params: {} }
      const p = transport.sendRequest(req)

      transport.rejectAll(new Error('closed'))
      await expect(p).rejects.toThrow()

      // Should not throw or do anything surprising
      const consumed = transport.handleResponseLine({ id, result: {} })
      expect(consumed).toBe(false)
    })
  })
})
