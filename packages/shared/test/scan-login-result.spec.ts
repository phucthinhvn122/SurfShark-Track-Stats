import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scanLoginResult, isIntermediateReply, looksTerminalReply } from '../src/index';

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

  it('does NOT flag a mixed terminal+intermediate reply as intermediate (reply collector must resolve)', () => {
    // Real-world case: bot appends "vui lòng chờ giây lát" to its success message.
    // The reply collector should treat this as terminal and resolve, not skip.
    assert.equal(isIntermediateReply('✅ Đăng nhập thành công. Vui lòng chờ giây lát.'), false);
    assert.equal(isIntermediateReply('Đăng nhập thành công, vui lòng đợi trong giây lát.'), false);
  });
});

describe('looksTerminalReply', () => {
  it('detects success outcomes in Vietnamese (with or without accents)', () => {
    assert.equal(looksTerminalReply('Đăng nhập thành công'), true);
    assert.equal(looksTerminalReply('Dang nhap thanh cong'), true);
    assert.equal(looksTerminalReply('✅ Đăng nhập thành công với mã: MJKX8Y!'), true);
    assert.equal(looksTerminalReply('Kích hoạt thành công'), true);
    assert.equal(looksTerminalReply('Đã kích hoạt'), true);
    assert.equal(looksTerminalReply('Hoàn tất'), true);
  });

  it('detects failure outcomes in Vietnamese', () => {
    assert.equal(looksTerminalReply('Đăng nhập thất bại'), true);
    assert.equal(looksTerminalReply('Không thành công'), true);
    assert.equal(looksTerminalReply('Key bị cấm'), true);
    assert.equal(looksTerminalReply('Tài khoản bị khóa'), true);
    assert.equal(looksTerminalReply('Key hết hạn'), true);
    assert.equal(looksTerminalReply('Mã không hợp lệ'), true);
    assert.equal(looksTerminalReply('Mã không tìm thấy'), true);
    assert.equal(looksTerminalReply('Mã không đúng'), true);
    assert.equal(looksTerminalReply('Sai mật khẩu'), true);
    assert.equal(looksTerminalReply('Đã được sử dụng'), true);
  });

  it('detects English/international terminal phrases', () => {
    assert.equal(looksTerminalReply('activated'), true);
    assert.equal(looksTerminalReply('logged in'), true);
    assert.equal(looksTerminalReply('success'), true);
    assert.equal(looksTerminalReply('authorized'), true);
    assert.equal(looksTerminalReply('banned'), true);
    assert.equal(looksTerminalReply('expired'), true);
    assert.equal(looksTerminalReply('invalid'), true);
  });

  it('flags a mixed terminal+intermediate reply as terminal (regression: must NOT be skipped by collector)', () => {
    assert.equal(looksTerminalReply('✅ Đăng nhập thành công. Vui lòng chờ giây lát.'), true);
    assert.equal(looksTerminalReply('Đăng nhập thành công, vui lòng đợi trong giây lát.'), true);
    assert.equal(looksTerminalReply('Processing complete: success'), true);
  });

  it('does NOT flag a pure placeholder as terminal', () => {
    assert.equal(looksTerminalReply('⏳ Đang xử lý đăng nhập với mã: ABC123'), false);
    assert.equal(looksTerminalReply('Dang xu ly'), false);
    assert.equal(looksTerminalReply('Please wait'), false);
    assert.equal(looksTerminalReply(''), false);
    assert.equal(looksTerminalReply(null), false);
  });
});
