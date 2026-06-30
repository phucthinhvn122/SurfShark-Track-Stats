import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scanLoginResult, isIntermediateReply } from '../src/index';

describe('scanLoginResult', () => {
  it('detects Vietnamese success text with or without accents', () => {
    assert.equal(scanLoginResult('Dang nhap thanh cong').status, 'success');
    assert.equal(scanLoginResult('Đăng nhập thành công').status, 'success');
    assert.equal(scanLoginResult('✅ Đăng nhập thành công với mã: MJKX8Y!').status, 'success');
  });

  it('detects Vietnamese failure text with or without accents', () => {
    assert.equal(scanLoginResult('Dang nhap that bai').status, 'failed');
    assert.equal(scanLoginResult('Đăng nhập thất bại').status, 'failed');
  });

  it('treats failure as higher priority than success', () => {
    assert.equal(scanLoginResult('thanh cong nhung that bai').status, 'failed');
  });

  it('returns unknown when neither phrase is present', () => {
    assert.equal(scanLoginResult('Dang xu ly').status, 'unknown');
  });
});

describe('isIntermediateReply', () => {
  it('detects the transient processing placeholder (with or without accents)', () => {
    assert.equal(isIntermediateReply('⏳ Đang xử lý đăng nhập với mã: ERYVGE...'), true);
    assert.equal(isIntermediateReply('Dang xu ly dang nhap'), true);
    assert.equal(isIntermediateReply('Processing, please wait'), true);
  });

  it('treats terminal success/failure replies as non-intermediate', () => {
    assert.equal(isIntermediateReply('✅ Đăng nhập thành công với mã: MJKX8Y!'), false);
    assert.equal(isIntermediateReply('Đăng nhập thất bại'), false);
    assert.equal(isIntermediateReply(''), false);
    assert.equal(isIntermediateReply(null), false);
  });
});
