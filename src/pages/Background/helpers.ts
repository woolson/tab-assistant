
export const Logger = {
  debug: process.env.NODE_ENV === 'development',

  prifix: '[Tab Assistant]',

  log(...args: any[]) {
    console.log(this.prifix, ...args);
  }
}