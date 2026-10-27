async page => {
  const box=page.getByRole('textbox',{name:'向课件提问'});
  await box.fill('这次学习的记忆暗号是“银杏树”。请用两句话解释第75页为什么重新声明 pi 后，area 1.0 仍使用原来的值；记住这个暗号供后面追问。');
  const response=page.waitForResponse(r=>r.url().endsWith('/api/turns')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'发送问题',exact:true}).click();
  const turn=await(await response).json();if(!turn.id)throw Error(JSON.stringify(turn));
  await page.evaluate(t=>localStorage.setItem('pointer-qa',JSON.stringify({conversationId:t.conversationId,seedTurn:t.id,documentId:t.snapshot.documentId})),turn);
  return {turnId:turn.id,conversationId:turn.conversationId};
}
