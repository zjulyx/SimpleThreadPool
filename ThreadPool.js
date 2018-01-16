// internal web worker wrapper class
class WorkerThread {
    constructor(workerPath) {
        this.worker = new Worker(workerPath)
        this.dead = false
        this.run = () => {
            if (this.dead) {
                // if thread is dead, don't loop any more
                return
            }

            if (ThreadPool.GetInstance().taskQueue.length === 0) {
                // no task in queue, loop again
                setImmediate(this.run)
            } else {
                // find a task (with args and finishCb), execute it
                let task = ThreadPool.GetInstance().taskQueue.pop()
                ++ThreadPool.GetInstance().runningThreadNum
                this.worker.postMessage(task.args)
                this.worker.onmessage = (e) => {
                    task.finishCb(e)
                    --ThreadPool.GetInstance().runningThreadNum
                    // finish current work, loop again
                    setImmediate(this.run)
                }
            }
        }
        this.start = () => {
            // revive and then run
            this.dead = false
            this.run()
        }
        this.stop = () => {
            // force stop, but will still execute current running job
            this.dead = true
        }
    }
}

// public thread pool class
export class ThreadPool {
    constructor(maxThreadNum, workerPath) {
        this.timeout = false
        this.runningThreadNum = 0
        this.workerThreads = []
        this.taskQueue = []
        this.maxThreadNum = maxThreadNum
        for (let i = 0; i < this.maxThreadNum; ++i) {
            this.workerThreads[i] = new WorkerThread(workerPath)
        }

        this._checkFinished = (finishCb, timeoutCb, ...args) => {
            if (this.timeout) {
                // timeout, terminate and call timeout callback
                this.timeout = false
                this.terminate()
                timeoutCb()
            } else if (this.taskQueue.length !== 0 || this.runningThreadNum > 0) {
                // not finish yet, loop again
                setImmediate(this._checkFinished, finishCb, timeoutCb, ...args)
            } else {
                // all tasks and workers are finished before time out
                if (this.timeoutId) {
                    clearTimeout(this.timeoutId)
                }
                this.terminate()
                finishCb(...args)
            }
        }

        // private method to set timeout
        this._checkTimeout = (timeoutSeconds) => {
            if (timeoutSeconds === 0) {
                // set timeout to indefinite
                return
            }

            this.timeoutId = setTimeout(
                _ => {
                    this.timeout = true
                },
                timeoutSeconds * 1000
            )
        }
    }

    // mimic singleton...
    static GetInstance(maxThreadNum, workerPath) {
        if (!ThreadPool.instance) {
            ThreadPool.instance = new ThreadPool(maxThreadNum, workerPath)
        }
        return ThreadPool.instance
    }

    // start all workers
    start() {
        for (let i = 0; i < this.maxThreadNum; ++i) {
            this.workerThreads[i].start()
        }
    }

    // terminate all workers
    terminate() {
        for (let worker of this.workerThreads) {
            worker.stop()
        }
    }

    // push single or multiple tasks to task queue
    execute(tasks) {
        if (tasks instanceof Array) {
            for (let task of tasks) {
                ThreadPool.GetInstance().taskQueue.push(task)
            }
        } else {
            ThreadPool.GetInstance().taskQueue.push(tasks)
        }
    }

    // check if all workers are finished and whether the time is out
    checkAllFinished(finishCb, timeoutCb, timeoutSeconds, ...args) {
        this._checkFinished(finishCb, timeoutCb, ...args)
        this._checkTimeout(timeoutSeconds)
    }
}
