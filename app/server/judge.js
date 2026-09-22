'use strict';
/**
 * judge.js — 判分（客观题）
 * single: 答案 == 用户答案
 * multiple: 归一化后字符集相等（顺序无关）
 * judge: true/false
 */

function norm(s) {
  return String(s || '').toUpperCase().replace(/[\s,，、.;；]+/g, '');
}

function isCorrect(question, userAnswer) {
  if (userAnswer === undefined || userAnswer === null || String(userAnswer).trim() === '') return null;
  const qa = norm(question.answer);
  const ua = norm(userAnswer);
  if (question.type === 'multiple') {
    return [...qa].sort().join('') === [...ua].sort().join('');
  }
  return qa === ua;
}

module.exports = { isCorrect, norm };
